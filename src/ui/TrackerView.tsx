import type { ReactNode } from 'react';
import { TrackerFactory, type Field, type MiscItem, type NoteField, type Project, type Section } from '../model/TrackerTypes';
import { TrackerStateController, state } from '../model/TrackerState';
import { TrackerDiffEngine } from '../comparison/TrackerDiff';
import { replaceChildrenWithReact } from './reactHelpers';
import { NavigationView, SheetTabsView, DiffChoicesView, DiffReportView, DiffStatusView,
  StatsView, MeetingFieldsView, AgendaView, TableView, SectionActionsView, FiltersView, DetailsView,
  SECTIONS, SECTION_NAME, isProject, type DiffSide, type DetailsGroup } from './views/Markup';

/**
 * Owns tracker UI state and DOM event handlers. TSX markup is implemented
 * separately in views/Markup.tsx so that imported Excel data is escaped.
 */
export class TrackerView {
  /** Services shared by all render methods: model, row factory and diff engine. */
  private readonly workspace = new TrackerStateController();
  private readonly factory = new TrackerFactory();
  private readonly comparator = new TrackerDiffEngine();

  private urgentOnly = false;
  private filterSequence = 0;
  private toastTimer: number | undefined;
  private activeSection = 'meeting';
  private onSelectWorkbook: ((filename: string) => void) | null = null;
  private onToggleDiff: ((enabled: boolean) => void) | null = null;
  private onSelectDiffSheet: ((side: DiffSide, index: number) => void) | null = null;

  /** Fail clearly if a page-shell mount point is missing. */
  private $<T extends HTMLElement>(selector: string): T {
    const element = document.querySelector<T>(selector);
    if (!element) throw new Error(`Missing Tracker Viewer control: ${selector}`);
    return element;
  }

  /** Turn a pure TSX view into nodes and replace the old children. */
  private paint(selector: string, node: ReactNode): void {
    replaceChildrenWithReact(this.$(selector), node);
  }

  /** Select rows by tracker category without mutating original arrays. */
  private sectionData(section: Section): (Project | MiscItem)[] {
    return section === 'misc' ? state.tracker.misc : state.tracker.projects.filter(p => p.section === section);
  }

/** Match urgent state, free-text search and field filters. */
private matchItem(item: Project | MiscItem): boolean {
  if (this.urgentOnly && !item.urgent && !(isProject(item) ? item.urgentLines.overview.length || item.urgentLines.updates.length : item.urgentLines.length)) return false;
  const haystack = Object.values(item).filter(v => typeof v === 'string').join(' ').toLowerCase();
  if (state.query && !haystack.includes(state.query.toLowerCase().trim())) return false;
  return state.filters.every(f => {
    if (!f.value.trim()) return true;
    const value = f.field === 'all' ? haystack : String(isProject(item) ? item[f.field as Field] ?? '' : f.field === 'description' ? item.description : f.field === 'notes' ? item.notes : '');
    return value.toLowerCase().includes(f.value.trim().toLowerCase());
  });
}
/** Sort visible items without rearranging the original workbook. */
private visible(section: Section): (Project | MiscItem)[] {
  const rows = this.sectionData(section).filter(item => this.matchItem(item));
  if (state.sort) {
    const { field, descending } = state.sort;
    rows.sort((a,b) => String(isProject(a) ? a[field as Field] ?? '' : field === 'description' ? a.description : a.notes)
      .localeCompare(String(isProject(b) ? b[field as Field] ?? '' : field === 'description' ? b.description : b.notes), undefined, {numeric:true, sensitivity:'base'}) * (descending ? -1 : 1));
  }
  return rows;
}

/** Render navigation and bind active-section highlighting. */
private renderNavigation(): void {
  const counts: Record<string, number> = { meeting: state.tracker.agenda.length,
    projects: this.sectionData('projects').length, regional: this.sectionData('regional').length,
    misc: this.sectionData('misc').length };
  this.paint('#section-nav', <NavigationView active={this.activeSection} counts={counts} />);
  this.$('#section-nav').querySelectorAll<HTMLAnchorElement>('[data-nav]').forEach(link => {
    link.addEventListener('click', () => { this.activeSection = link.dataset.nav ?? 'meeting'; this.highlightNavigation(); });
  });
}
/** Highlight the currently selected section. */
private highlightNavigation(): void {
  document.querySelectorAll<HTMLElement>('[data-nav]').forEach(el => el.classList.toggle('active', el.dataset.nav===this.activeSection));
  this.$('#current-section').textContent = this.activeSection==='meeting' ? 'Meeting & agenda' : SECTION_NAME[this.activeSection as Section];
}
/** Workbook pills are files while worksheet pills are tabs within one file. */
public renderSheetTabs(): void {
  const deleteButton = this.$('#delete-sheet') as HTMLButtonElement;
  deleteButton.disabled = state.diffMode || state.sheets.length <= 1;
  deleteButton.title = deleteButton.disabled ? 'At least one worksheet must remain' : 'Delete the selected worksheet';
  this.paint('#sheet-tabs', <SheetTabsView />);
  this.$('#sheet-tabs').querySelectorAll<HTMLButtonElement>('[data-folder-file]').forEach(button => {
    button.onclick = () => this.onSelectWorkbook?.(button.dataset.folderFile ?? '');
  });
  this.$('#sheet-tabs').querySelectorAll<HTMLButtonElement>('[data-sheet]').forEach(button => {
    button.onclick = () => { this.workspace.select(Number(button.dataset.sheet)); this.render(); };
  });
}
/** Render read-only comparison results without modifying the editable workbook. */
private renderDiff(): void {
  this.$('#app').classList.toggle('diff-active', state.diffMode);
  const toggle = this.$('#diff-mode-toggle');
  toggle.classList.toggle('active', state.diffMode);
  toggle.setAttribute('aria-checked', String(state.diffMode));
  this.$('#diff-sidebar-hint').textContent = state.diffMode ? 'Choose From, then To' : 'Compare any two weeks';
  this.$('#diff-panel').hidden = !state.diffMode;
  if (!state.diffMode) return;
  this.$('#page-title').textContent = 'Compare weekly trackers';
  this.$('#page-subtitle').textContent = 'Choose any two weekly workbook pills to see the differences. This view is read-only.';
  this.paint('#diff-choices', <DiffChoicesView />);
  this.$('#diff-choices').querySelectorAll<HTMLSelectElement>('[data-diff-side]').forEach(control => {
    control.onchange = () => this.onSelectDiffSheet?.(control.dataset.diffSide as DiffSide, Number(control.value));
  });
  if (state.diffLoading) { this.paint('#diff-results', <DiffStatusView message="Reading both workbooks and comparing rows…" />); return; }
  if (state.diffError) { this.paint('#diff-results', <DiffStatusView message={state.diffError} failed />); return; }
  const old = state.diffWorkbooks.find(item => item.filename === state.diffSelected[0]);
  const next = state.diffWorkbooks.find(item => item.filename === state.diffSelected[1]);
  if (!old || !next) { this.paint('#diff-results', null); return; }
  const before = old.sheets[state.diffFromSheet];
  const after = next.sheets[state.diffToSheet];
  if (!before || !after) { this.paint('#diff-results', <DiffStatusView message="Selected worksheet is missing." failed />); return; }
  this.paint('#diff-results', <DiffReportView report={this.comparator.compare(before, after)} />);
}
/** Recompute overview counters after every edit or workbook change. */
private renderStats(): void {
  const urgent = state.tracker.projects.filter(p =>
    p.urgent || p.urgentLines.overview.length || p.urgentLines.updates.length).length
    + state.tracker.misc.filter(m => m.urgent || m.urgentLines.length).length;
  this.paint('#stats', <StatsView urgent={urgent} />);
}
/** Attach inline editors to every editable data field. */
private bindEditable(root: Element): void {
  root.querySelectorAll<HTMLElement>('[data-field]').forEach(cell => cell.onclick = () => this.editCell(cell));
}
/** Overlay an editor and commit values on blur without changing the grid geometry. */
private editCell(cell: HTMLElement): void {
  if (cell.classList.contains('editing')) return;
  const field = cell.dataset.field!;
  const meetingIndex = cell.closest<HTMLElement>('[data-meeting]')?.dataset.meeting;
  const agendaId = cell.closest<HTMLElement>('[data-agenda]')?.dataset.agenda;
  const itemId = cell.closest<HTMLElement>('[data-id]')?.dataset.id;
  const target = meetingIndex !== undefined ? state.tracker.meeting[Number(meetingIndex)] as unknown as Record<string,string>
    : agendaId ? state.tracker.agenda.find(a => a.id===agendaId) as unknown as Record<string,string>
    : [...state.tracker.projects,...state.tracker.misc].find(x=>x.id===itemId) as unknown as Record<string,string>;
  if (!target) return;
  const original = String(target[field]??'');
  const multiline = ['overview','updates','notes','topic'].includes(field) || original.includes('\n');
  const input = document.createElement(multiline ? 'textarea' : 'input');
  if (input instanceof HTMLInputElement) input.type = 'text';
  input.className = 'cell-editor'; input.value = original;
  input.setAttribute('aria-label',`Edit ${field}`);
  if (input instanceof HTMLTextAreaElement) input.rows = Math.max(2, Math.min(8, this.factory.lines(original).length+1));
  let cancelled = false;
  const finish = () => {
    if (!cell.contains(input)) return;
    cell.classList.remove('editing');
    if (!cancelled && target[field]!==input.value) { target[field]=input.value; this.workspace.markChanged(); }
    this.renderContent();
  };
  input.addEventListener('keydown',(event)=>{const e=event as KeyboardEvent;
    if(e.key==='Escape') {cancelled=true;input.blur();return;}
    if(e.key==='Enter' && !multiline) {e.preventDefault();input.blur();return;}
    if(e.key==='Enter' && multiline && ['overview','updates','notes'].includes(field) && !e.shiftKey && !e.ctrlKey) {
      e.preventDefault(); input.setRangeText('\n• ',input.selectionStart ?? 0,input.selectionEnd ?? 0,'end');
    }
  });
  input.addEventListener('blur',finish,{once:true});
  // Overlay the editor instead of replacing the cell content. Table/grid geometry is unchanged.
  cell.classList.add('editing'); cell.append(input); input.focus(); if(!multiline) input.select();
}
/** Render meeting and agenda TSX, then attach edit, delete and urgency controls. */
private renderMeeting(): void {
  this.paint('#meeting-fields', <MeetingFieldsView />);
  this.$('#meeting-fields').querySelectorAll<HTMLButtonElement>('[data-delete-meeting]').forEach(button => button.onclick = () => {
    state.tracker.meeting.splice(Number(button.dataset.deleteMeeting), 1); this.workspace.markChanged(); this.renderContent();
  });
  this.bindEditable(this.$('#meeting-fields'));
  this.paint('#agenda-table', <AgendaView />);
  this.bindEditable(this.$('#agenda-table'));
  this.$('#agenda-table').querySelectorAll<HTMLButtonElement>('[data-agenda-action]').forEach(button => button.onclick = () => {
    const row = button.closest<HTMLElement>('[data-agenda]');
    const item = state.tracker.agenda.find(a => a.id === row?.dataset.agenda);
    if (!item) return;
    if (button.dataset.agendaAction === 'urgent') item.urgent = !item.urgent;
    if (button.dataset.agendaAction === 'delete' && !window.confirm('Delete this agenda item?')) return;
    if (button.dataset.agendaAction === 'delete') state.tracker.agenda = state.tracker.agenda.filter(a => a.id !== item.id);
    this.workspace.markChanged(); this.renderContent();
  });
}
/** Table columns are proportional CSS rules, never inline pixel markup. */
private renderTable(section: Section): void {
  const items = this.visible(section);
  this.paint(`#${section}-table`, <TableView section={section} items={items} />);
  this.$(`#${section}-count`).textContent = `${items.length} of ${this.sectionData(section).length}`;
  const table = this.$(`#${section}-table`);
  this.bindEditable(table);
  table.querySelectorAll<HTMLButtonElement>('[data-sort]').forEach(button=>button.onclick=()=>{
    const field=button.dataset.sort as Field|'description'|'notes';
    state.sort={field,descending:state.sort?.field===field?!state.sort.descending:false}; this.renderTables();
  });
  table.querySelectorAll<HTMLButtonElement>('[data-action]').forEach(button=>button.onclick=()=>{
    const id=button.closest<HTMLElement>('[data-id]')?.dataset.id;
    const item=[...state.tracker.projects,...state.tracker.misc].find(x=>x.id===id);
    if(!item)return;
    if(button.dataset.action==='urgent'){item.urgent=!item.urgent;this.workspace.markChanged();this.renderContent();return;}
    if(button.dataset.action==='details') {this.showDetails(item);return;}
    if(button.dataset.action==='delete'&&window.confirm('Delete this item?')) {
      state.tracker.projects=state.tracker.projects.filter(p=>p.id!==id); state.tracker.misc=state.tracker.misc.filter(m=>m.id!==id);
      this.workspace.markChanged();this.hideDetails();this.renderContent();
    }
  });
}

/** Refresh all three data tables after sorting or filtering. */
private renderTables():void {SECTIONS.forEach(section => this.renderTable(section));}
/** Attach add-row controls and section-wide urgency toggles. */
private renderActions():void {
  for(const section of SECTIONS){
    const holder=this.$(`#${section}-actions`);
    const urgent=state.tracker.urgentSections[section];
    this.paint(`#${section}-actions`, <SectionActionsView section={section} />);
    holder.querySelector<HTMLButtonElement>('[data-section-urgent]')!.onclick=()=>{state.tracker.urgentSections[section]=!state.tracker.urgentSections[section];this.workspace.markChanged();this.renderContent();};
    holder.querySelectorAll<HTMLButtonElement>('[data-add]').forEach(button=>button.onclick=()=>{
      const kind=button.dataset.add;
      if(kind==='misc')state.tracker.misc.push({id:this.factory.newId(),description:'',notes:'',urgent:false,urgentLines:[]});
      if(kind!=='misc') {const p=this.factory.newProject(kind==='regional'?'regional':'projects');p.projectNo=kind==='enquiry'?'Enquiry':p.projectNo;state.tracker.projects.push(p);}
      this.workspace.markChanged();this.renderContent();
      const first=this.$(`#${section}-table`).querySelector<HTMLElement>('tr:last-child td[data-field]');first?.click();
    });
    this.$(`#${section}`).classList.toggle('section-urgent',urgent);
  }
}
/** Keep each filter input connected to the search model. */
private renderFilters():void {
  this.paint('#filters', <FiltersView filters={state.filters} />);
  this.$('#filters').querySelectorAll<HTMLSelectElement>('select').forEach(select=>select.onchange=()=>{
    const f=state.filters.find(f=>f.id===Number(select.dataset.filter));if(f)f.field=select.value as typeof f.field;this.renderTables();
  });
  this.$('#filters').querySelectorAll<HTMLInputElement>('input').forEach(input=>input.oninput=()=>{
    const f=state.filters.find(f=>f.id===Number(input.dataset.filter));if(f)f.value=input.value;this.renderTables();
  });
  this.$('#filters').querySelectorAll<HTMLButtonElement>('[data-remove]').forEach(button=>button.onclick=()=>{
    state.filters=state.filters.filter(f=>f.id!==Number(button.dataset.remove));this.renderFilters();this.renderTables();
  });
}
/** Close the side panel and clear its selection. */
private hideDetails(): void { this.$('#details').hidden=true;state.selectedId=null; }
/** Edit individual bullet lines while maintaining urgent line indices. */
private showDetails(item:Project|MiscItem):void {
  state.selectedId=item.id;const panel=this.$('#details');panel.hidden=false;
  const groups: DetailsGroup[]=isProject(item)
    ?[{field:'overview',label:'Overview',text:item.overview,urgent:item.urgentLines.overview},{field:'updates',label:'Updates',text:item.updates,urgent:item.urgentLines.updates}]
    :[{field:'notes',label:'Notes',text:item.notes,urgent:item.urgentLines}];
  this.paint('#details', <DetailsView item={item} groups={groups} />);
  panel.querySelector<HTMLButtonElement>('#close-details')!.onclick=()=>this.hideDetails();
  panel.querySelectorAll<HTMLElement>('[data-detail]').forEach(group=>{
    const field=group.dataset.detail as NoteField|'notes';
    const content=()=>isProject(item)?item[field as NoteField]:item.notes;
    const urgent=()=>isProject(item)?item.urgentLines[field as NoteField]:item.urgentLines;
    const set=(parts:string[],indices:number[])=>{
      if(isProject(item)){item[field as NoteField]=parts.join('\n');item.urgentLines[field as NoteField]=indices;}
      else {item.notes=parts.join('\n');item.urgentLines=indices;}
      this.workspace.markChanged();this.renderContent();this.showDetails(item);
    };
    group.querySelectorAll<HTMLButtonElement>('[data-urgent-line]').forEach(button=>button.onclick=()=>{
      const index=Number(button.dataset.urgentLine);const selected=new Set(urgent());selected.has(index)?selected.delete(index):selected.add(index);set(this.factory.lines(content()),[...selected]);
    });
    group.querySelectorAll<HTMLButtonElement>('[data-delete-line]').forEach(button=>button.onclick=()=>{
      const i=Number(button.dataset.deleteLine);const a=this.factory.lines(content());a.splice(i,1);set(a,urgent().filter(n=>n!==i).map(n=>n>i?n-1:n));
    });
    group.querySelectorAll<HTMLTextAreaElement>('[data-edit-line]').forEach(area=>area.onchange=()=>{
      const a=this.factory.lines(content());a[Number(area.dataset.editLine)]=area.value;set(a,urgent());
    });
  });
  panel.querySelectorAll<HTMLButtonElement>('[data-add-line]').forEach(button=>button.onclick=()=>{
    const field=button.dataset.addLine as NoteField|'notes';
    if(isProject(item))item[field as NoteField]+=(item[field as NoteField]?'\n':'')+this.factory.bullet('New note');
    else item.notes+=(item.notes?'\n':'')+this.factory.bullet('New note');
    this.workspace.markChanged();this.renderContent();this.showDetails(item);
  });
}
/** Refresh the workbook-dependent views in one pass. */
private renderContent():void {
  this.$('#source-title').textContent=state.tracker.sourceName||'No workbook loaded';
  this.$('#source-path').textContent=state.tracker.sourceName?`Loaded from ${state.loadingFrom}`:'Open a tracker or connect a folder.';
  this.renderSheetTabs();this.renderNavigation();this.renderMeeting();this.renderStats();this.renderActions();this.renderTables();this.renderDiff();
}
/** Refresh every visible section and restore the normal page title. */
public render():void {
  this.renderContent();this.renderFilters();
  if (!state.diffMode) {
    this.$('#page-title').textContent = 'Projects & enquiries';
    this.$('#page-subtitle').textContent = 'Edit cells directly, manage notes, and create a dated weekly workbook.';
  }
}
/** Register the initial controls, workbook callbacks and intersection observer. */
public setupUI(
  onFileSelect: (filename: string) => void,
  onModeChange: (enabled: boolean) => void,
  onSheetChange: (side: 'from' | 'to', index: number) => void,
):void {
  this.onSelectWorkbook = onFileSelect;
  this.onToggleDiff = onModeChange;
  this.onSelectDiffSheet = onSheetChange;
  this.$('#diff-mode-toggle').onclick = () => this.onToggleDiff?.(!state.diffMode);
  this.$('#search-input').addEventListener('input',e=>{state.query=(e.target as HTMLInputElement).value;this.renderTables();});
  this.$('#urgent-only').addEventListener('change',e=>{this.urgentOnly=(e.target as HTMLInputElement).checked;this.renderTables();});
  this.$('#filter-add').addEventListener('click',()=>{this.filterSequence = Math.max(this.filterSequence, ...state.filters.map(f => f.id), 0) + 1; state.filters.push({id:this.filterSequence,field:'all',value:''});this.renderFilters();this.$('#filters').querySelector<HTMLInputElement>('input:last-of-type')?.focus();});
  this.$('#meeting-add').onclick=()=>{state.tracker.meeting.push({label:'New field',value:''});this.workspace.markChanged();this.renderContent();};
  this.$('#agenda-add').onclick=()=>{state.tracker.agenda.push({id:this.factory.newId(),number:String(state.tracker.agenda.length+1),topic:'',attendee:'',time:'',urgent:false});this.workspace.markChanged();this.renderContent();};
  this.$('#delete-sheet').onclick=()=>{
    if (state.sheets.length <= 1) return;
    const name=this.factory.sheetLabel(state.tracker,state.activeSheet);
    if (!window.confirm(`Delete weekly sheet ${name}? This removes its data from the current workspace and auto-saved draft. This removes the worksheet from the original Excel workbook when auto-save completes.`)) return;
    if (!this.workspace.remove(state.activeSheet)) return;
    this.hideDetails();this.render();
  };
  const sections=document.querySelectorAll<HTMLElement>('.content-section');
  const observer=new IntersectionObserver(entries=>{
    const visible=entries.filter(e=>e.isIntersecting).sort((a,b)=>a.boundingClientRect.top-b.boundingClientRect.top);
    if(visible[0]){this.activeSection=visible[0].target.id;this.highlightNavigation();}
  },{rootMargin:'-105px 0px -60% 0px',threshold:0});
  sections.forEach(s=>observer.observe(s));this.render();
}
/** Display a temporary status or error message. */
public notify(message:string,error=false):void {
  if(this.toastTimer)clearTimeout(this.toastTimer);
  const el=this.$('#toast');el.hidden=false;el.textContent=message;el.classList.toggle('toast-error',error);
  el.onclick=()=>{el.hidden=true;if(this.toastTimer)clearTimeout(this.toastTimer);};
  this.toastTimer=window.setTimeout(()=>{el.hidden=true;},error?4500:1200);
}

}

/** One view instance retains filtering and toast state between renders. */
export const trackerView = new TrackerView();
