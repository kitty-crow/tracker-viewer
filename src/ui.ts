import { bullet, FIELDS, HEADERS, lines, newId, newProject, sheetLabel, type Field, type MiscItem, type NoteField, type Project, type Section, type AgendaItem } from './types';
import { changed, deleteSheet, selectSheet, state } from './state';
const $ = <T extends HTMLElement>(selector: string): T => document.querySelector<T>(selector)!;
const html = (value: unknown): string => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]!));
const SECTIONS: Section[] = ['projects', 'regional', 'misc'];
const SECTION_NAME: Record<Section,string> = {projects:'Projects & enquiries', regional:'Middle East region', misc:'Miscellaneous'};
const project = (item: Project | MiscItem): item is Project => 'client' in item;
let urgentOnly = false;
let filterSequence = 0;
let toastTimer: number | undefined;
let activeSection = 'meeting';
const sectionData = (section: Section): (Project | MiscItem)[] => section === 'misc' ? state.tracker.misc : state.tracker.projects.filter(p => p.section === section);
function matchItem(item: Project | MiscItem): boolean {
  if (urgentOnly && !item.urgent && !(project(item) ? item.urgentLines.overview.length || item.urgentLines.updates.length : item.urgentLines.length)) return false;
  const haystack = Object.values(item).filter(v => typeof v === 'string').join(' ').toLowerCase();
  if (state.query && !haystack.includes(state.query.toLowerCase().trim())) return false;
  return state.filters.every(f => {
    if (!f.value.trim()) return true;
    const value = f.field === 'all' ? haystack : String(project(item) ? item[f.field as Field] ?? '' : f.field === 'description' ? item.description : f.field === 'notes' ? item.notes : '');
    return value.toLowerCase().includes(f.value.trim().toLowerCase());
  });
}
function visible(section: Section): (Project | MiscItem)[] {
  const rows = sectionData(section).filter(matchItem);
  if (state.sort) {
    const { field, descending } = state.sort;
    rows.sort((a,b) => String(project(a) ? a[field as Field] ?? '' : field === 'description' ? a.description : a.notes)
      .localeCompare(String(project(b) ? b[field as Field] ?? '' : field === 'description' ? b.description : b.notes), undefined, {numeric:true, sensitivity:'base'}) * (descending ? -1 : 1));
  }
  return rows;
}
function notesMarkup(value: string, urgent: number[]): string {
  const all = lines(value);
  if (!all.length) return '<span class="empty-cell">Edit</span>';
  return `<div class="note-preview">${all.slice(0,4).map((t,i) => `<div class="note-item ${urgent.includes(i) ? 'is-urgent' : ''}">${html(t)}</div>`).join('')}${all.length>4 ? `<span class="note-more">+${all.length-4} more</span>` : ''}</div>`;
}
function rowMarkup(item: Project | MiscItem): string {
  if (!project(item)) return `<tr data-id="${html(item.id)}" class="${item.urgent ? 'row-urgent' : ''}"><td data-field="description">${html(item.description) || '<span class="empty-cell">Edit</span>'}</td><td class="note-cell" data-field="notes">${notesMarkup(item.notes,item.urgentLines)}</td>${actions(item)}</tr>`;
  return `<tr data-id="${html(item.id)}" class="${item.urgent ? 'row-urgent' : ''}">${FIELDS.map(f => `<td data-field="${f}" class="${f === 'overview'||f === 'updates' ? 'note-cell':''}">${f === 'overview' || f === 'updates' ? notesMarkup(item[f], item.urgentLines[f]) : html(item[f]) || '<span class="empty-cell">Edit</span>'}</td>`).join('')}${actions(item)}</tr>`;
}
function actions(item: Project | MiscItem): string {
  return `<td class="row-actions"><div class="row-action-buttons"><button class="icon-button ${item.urgent ? 'selected-urgent' : ''}" data-action="urgent" title="Toggle urgency">!</button><button class="icon-button" data-action="details" title="Edit note lines">☷</button><button class="icon-button delete" data-action="delete" title="Delete">×</button></div></td>`;
}
function renderNavigation(): void {
  const navigation: {id:string; title:string; count:number; icon:string}[] = [
    {id:'meeting',title:'Meeting & agenda',count:state.tracker.agenda.length,icon:'▤'},
    {id:'projects',title:SECTION_NAME.projects,count:sectionData('projects').length,icon:'▦'},
    {id:'regional',title:SECTION_NAME.regional,count:sectionData('regional').length,icon:'◈'},
    {id:'misc',title:SECTION_NAME.misc,count:sectionData('misc').length,icon:'☷'}
  ];
  $('#section-nav').innerHTML = navigation.map(n => `<a href="#${n.id}" class="nav-item ${activeSection===n.id?'active':''}" data-nav="${n.id}"><span class="nav-symbol">${n.icon}</span><span>${n.title}</span><span class="nav-count">${n.count}</span></a>`).join('');
  $('#section-nav').querySelectorAll<HTMLAnchorElement>('[data-nav]').forEach(link => link.addEventListener('click', () => { activeSection = link.dataset.nav!; highlightNavigation(); }));
}
function highlightNavigation(): void {
  document.querySelectorAll<HTMLElement>('[data-nav]').forEach(el => el.classList.toggle('active', el.dataset.nav===activeSection));
  $('#current-section').textContent = activeSection==='meeting' ? 'Meeting & agenda' : SECTION_NAME[activeSection as Section];
}
function renderSheetTabs(): void {
  const deleteButton = $('#delete-sheet') as HTMLButtonElement;
  deleteButton.disabled = state.sheets.length <= 1;
  deleteButton.title = deleteButton.disabled ? 'At least one weekly sheet must remain' : 'Delete the selected weekly sheet';
  $('#sheet-tabs').innerHTML = state.sheets.map((sheet,i) => `<button class="sheet-tab ${i===state.activeSheet?'active':''}" data-sheet="${i}" type="button">${html(sheetLabel(sheet,i))}${i===state.activeSheet?' <span class="sheet-current">●</span>':''}</button>`).join('');
  $('#sheet-tabs').querySelectorAll<HTMLButtonElement>('[data-sheet]').forEach(button => button.onclick = () => {
    selectSheet(Number(button.dataset.sheet)); changed(); render();
  });
}
function renderStats(): void {
  const all = state.tracker.projects;
  const urgent = all.filter(p=>p.urgent||p.urgentLines.overview.length||p.urgentLines.updates.length).length + state.tracker.misc.filter(m=>m.urgent||m.urgentLines.length).length;
  $('#stats').innerHTML = [
    ['Projects & enquiries',all.filter(p=>p.section==='projects').length,'▦'],
    ['Enquiries',all.filter(p=>/enquiry/i.test(p.projectNo)).length,'⌕'],
    ['Urgent items',urgent,'!'],
    ['Regional projects',all.filter(p=>p.section==='regional').length,'◈']
  ].map(([label,n,icon])=>`<div class="stat"><span class="stat-icon">${icon}</span><div><div class="stat-value">${n}</div><div class="stat-name">${label}</div></div></div>`).join('');
}
function bindEditable(root: Element): void {
  root.querySelectorAll<HTMLElement>('[data-field]').forEach(cell => cell.onclick = () => editCell(cell));
}
function editCell(cell: HTMLElement): void {
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
  if (input instanceof HTMLTextAreaElement) input.rows = Math.max(2, Math.min(8, lines(original).length+1));
  let cancelled = false;
  const finish = () => {
    if (!cell.contains(input)) return;
    cell.classList.remove('editing');
    if (!cancelled && target[field]!==input.value) { target[field]=input.value; changed(); }
    renderContent();
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
function renderMeeting(): void {
  $('#meeting-fields').innerHTML = state.tracker.meeting.map((item,i)=>`<div class="meeting-pair" data-meeting="${i}"><label data-field="label">${html(item.label)}</label><div class="meeting-value" data-field="value">${html(item.value)||'<span class="empty-cell">Edit</span>'}</div><button class="icon-button delete" title="Delete field" data-delete-meeting="${i}">×</button></div>`).join('');
  $('#meeting-fields').querySelectorAll<HTMLButtonElement>('[data-delete-meeting]').forEach(button=>button.onclick=()=>{
    state.tracker.meeting.splice(Number(button.dataset.deleteMeeting),1); changed();renderContent();
  });
  bindEditable($('#meeting-fields'));
  const fields: [keyof AgendaItem,string][] = [['number','No'],['topic','Topic'],['attendee','Attendee'],['time','Time allocated']];
  $('#agenda-table').innerHTML = `<div class="agenda-list" role="list" aria-label="Agenda items"><div class="agenda-row agenda-row-head" aria-hidden="true"><span>No</span><span>Topic</span><span>Attendee</span><span>Time</span><span></span></div>${state.tracker.agenda.map(a=>`<div role="listitem" class="agenda-row ${a.urgent?'row-urgent':''}" data-agenda="${html(a.id)}">${fields.map(([field])=>`<div class="agenda-field agenda-${field}" data-field="${field}" title="Click to edit ${field}">${html(a[field])||'<span class="empty-cell">Edit</span>'}</div>`).join('')}<div class="agenda-controls"><button class="icon-button ${a.urgent?'selected-urgent':''}" data-agenda-action="urgent" title="Toggle urgency" aria-label="Mark agenda item urgent">!</button><button class="icon-button delete" data-agenda-action="delete" title="Delete agenda item" aria-label="Delete agenda item">×</button></div></div>`).join('')}</div>`;
  bindEditable($('#agenda-table'));
  $('#agenda-table').querySelectorAll<HTMLButtonElement>('[data-agenda-action]').forEach(button=>button.onclick=()=>{
    const row = button.closest<HTMLElement>('[data-agenda]'); const item = state.tracker.agenda.find(a=>a.id===row?.dataset.agenda);
    if(!item) return;
    if(button.dataset.agendaAction==='urgent') item.urgent=!item.urgent;
    if(button.dataset.agendaAction==='delete' && !window.confirm('Delete this agenda item?')) return;
    if(button.dataset.agendaAction==='delete') state.tracker.agenda=state.tracker.agenda.filter(a=>a.id!==item.id);
    changed();renderContent();
  });
}
function renderTable(section: Section): void {
  const items=visible(section); const fields=section==='misc'?['description','notes']:[...FIELDS];
  const columns=fields.map(f=>`<th><button class="sort-button" data-sort="${f}">${f==='description'?'Description':f==='notes'?'Notes':HEADERS[f as Field]}${state.sort?.field===f?(state.sort.descending?' ↓':' ↑'):''}</button></th>`).join('');
  const cols = section === 'misc' ? [260, 580, 110] : [70, 120, 110, 115, 190, 140, 340, 390, 112];
  const groups = `<colgroup>${cols.map(w => `<col style="width:${w}px">`).join('')}</colgroup>`;
  $(`#${section}-table`).innerHTML=`<table class="data-table ${section==='misc'?'misc-table':''}">${groups}<thead><tr>${columns}<th class="actions-heading">Actions</th></tr></thead><tbody>${items.map(rowMarkup).join('')}</tbody></table>${items.length?'':'<div class="empty-state">No matching items</div>'}`;
  $(`#${section}-count`).textContent=`${items.length} of ${sectionData(section).length}`;
  const table=$(`#${section}-table`);
  bindEditable(table);
  table.querySelectorAll<HTMLButtonElement>('[data-sort]').forEach(button=>button.onclick=()=>{
    const field=button.dataset.sort as Field|'description'|'notes';
    state.sort={field,descending:state.sort?.field===field?!state.sort.descending:false}; renderTables();
  });
  table.querySelectorAll<HTMLButtonElement>('[data-action]').forEach(button=>button.onclick=()=>{
    const id=button.closest<HTMLElement>('[data-id]')?.dataset.id;
    const item=[...state.tracker.projects,...state.tracker.misc].find(x=>x.id===id);
    if(!item)return;
    if(button.dataset.action==='urgent'){item.urgent=!item.urgent;changed();renderContent();return;}
    if(button.dataset.action==='details') {showDetails(item);return;}
    if(button.dataset.action==='delete'&&window.confirm('Delete this item?')) {
      state.tracker.projects=state.tracker.projects.filter(p=>p.id!==id); state.tracker.misc=state.tracker.misc.filter(m=>m.id!==id);
      changed();hideDetails();renderContent();
    }
  });
}
function renderTables():void {SECTIONS.forEach(renderTable);}
function renderActions():void {
  for(const section of SECTIONS){
    const holder=$(`#${section}-actions`);
    const urgent=state.tracker.urgentSections[section];
    holder.innerHTML=`<button class="button ${urgent?'selected-urgent':''}" data-section-urgent="${section}">! ${urgent?'Clear urgent':'Urgent'}</button>`+(section==='projects'?'<button class="button" data-add="enquiry">+ Enquiry</button><button class="button button-primary" data-add="project">+ Project</button>':`<button class="button button-primary" data-add="${section}">+ ${section==='misc'?'Note':'Project'}</button>`);
    holder.querySelector<HTMLButtonElement>('[data-section-urgent]')!.onclick=()=>{state.tracker.urgentSections[section]=!state.tracker.urgentSections[section];changed();renderContent();};
    holder.querySelectorAll<HTMLButtonElement>('[data-add]').forEach(button=>button.onclick=()=>{
      const kind=button.dataset.add;
      if(kind==='misc')state.tracker.misc.push({id:newId(),description:'',notes:'',urgent:false,urgentLines:[]});
      if(kind!=='misc') {const p=newProject(kind==='regional'?'regional':'projects');p.projectNo=kind==='enquiry'?'Enquiry':p.projectNo;state.tracker.projects.push(p);}
      changed();renderContent();
      const first=$(`#${section}-table`).querySelector<HTMLElement>('tr:last-child td[data-field]');first?.click();
    });
    $(`#${section}`).classList.toggle('section-urgent',urgent);
  }
}
function renderFilters():void {
  $('#filters').innerHTML=state.filters.map(filter=>`<label class="filter-pill"><select data-filter="${filter.id}" data-part="field" aria-label="Filter field"><option value="all" ${filter.field==='all'?'selected':''}>Any field</option>${[...FIELDS,'description','notes'].map(field=>`<option value="${field}" ${filter.field===field?'selected':''}>${HEADERS[field as Field]??(field==='notes'?'Notes':'Description')}</option>`).join('')}</select><input data-filter="${filter.id}" data-part="value" value="${html(filter.value)}" placeholder="Contains…" aria-label="Filter value"><button class="filter-remove" data-remove="${filter.id}" title="Remove filter">×</button></label>`).join('');
  $('#filters').querySelectorAll<HTMLSelectElement>('select').forEach(select=>select.onchange=()=>{
    const f=state.filters.find(f=>f.id===Number(select.dataset.filter));if(f)f.field=select.value as typeof f.field;renderTables();
  });
  $('#filters').querySelectorAll<HTMLInputElement>('input').forEach(input=>input.oninput=()=>{
    const f=state.filters.find(f=>f.id===Number(input.dataset.filter));if(f)f.value=input.value;renderTables();
  });
  $('#filters').querySelectorAll<HTMLButtonElement>('[data-remove]').forEach(button=>button.onclick=()=>{
    state.filters=state.filters.filter(f=>f.id!==Number(button.dataset.remove));renderFilters();renderTables();
  });
}
function hideDetails(): void { $('#details').hidden=true;state.selectedId=null; }
function showDetails(item:Project|MiscItem):void {
  state.selectedId=item.id;const panel=$('#details');panel.hidden=false;
  const groups:{field:NoteField|'notes';label:string;text:string;urgent:number[]}[]=project(item)
    ?[{field:'overview',label:'Overview',text:item.overview,urgent:item.urgentLines.overview},{field:'updates',label:'Updates',text:item.updates,urgent:item.urgentLines.updates}]
    :[{field:'notes',label:'Notes',text:item.notes,urgent:item.urgentLines}];
  panel.innerHTML=`<div class="details-heading"><div><span class="eyebrow">NOTES</span><h2>${html(project(item)?item.well||item.client||'Project':item.description||'Note')}</h2></div><button class="icon-button" id="close-details">×</button></div>`+groups.map(g=>`<div class="details-group" data-detail="${g.field}"><h3>${g.label} <span>${lines(g.text).length} lines</span></h3>${lines(g.text).map((t,i)=>`<div class="detail-line"><button class="icon-button ${g.urgent.includes(i)?'selected-urgent':''}" data-urgent-line="${i}">!</button><textarea data-edit-line="${i}" rows="2">${html(t)}</textarea><button class="icon-button delete" data-delete-line="${i}">×</button></div>`).join('')}<button class="button add-line" data-add-line="${g.field}">+ Bullet</button></div>`).join('');
  panel.querySelector<HTMLButtonElement>('#close-details')!.onclick=hideDetails;
  panel.querySelectorAll<HTMLElement>('[data-detail]').forEach(group=>{
    const field=group.dataset.detail as NoteField|'notes';
    const content=()=>project(item)?item[field as NoteField]:item.notes;
    const urgent=()=>project(item)?item.urgentLines[field as NoteField]:item.urgentLines;
    const set=(parts:string[],indices:number[])=>{
      if(project(item)){item[field as NoteField]=parts.join('\n');item.urgentLines[field as NoteField]=indices;}
      else {item.notes=parts.join('\n');item.urgentLines=indices;}
      changed();renderContent();showDetails(item);
    };
    group.querySelectorAll<HTMLButtonElement>('[data-urgent-line]').forEach(button=>button.onclick=()=>{
      const index=Number(button.dataset.urgentLine);const selected=new Set(urgent());selected.has(index)?selected.delete(index):selected.add(index);set(lines(content()),[...selected]);
    });
    group.querySelectorAll<HTMLButtonElement>('[data-delete-line]').forEach(button=>button.onclick=()=>{
      const i=Number(button.dataset.deleteLine);const a=lines(content());a.splice(i,1);set(a,urgent().filter(n=>n!==i).map(n=>n>i?n-1:n));
    });
    group.querySelectorAll<HTMLTextAreaElement>('[data-edit-line]').forEach(area=>area.onchange=()=>{
      const a=lines(content());a[Number(area.dataset.editLine)]=area.value;set(a,urgent());
    });
  });
  panel.querySelectorAll<HTMLButtonElement>('[data-add-line]').forEach(button=>button.onclick=()=>{
    const field=button.dataset.addLine as NoteField|'notes';
    if(project(item))item[field as NoteField]+=(item[field as NoteField]?'\n':'')+bullet('New note');
    else item.notes+=(item.notes?'\n':'')+bullet('New note');
    changed();renderContent();showDetails(item);
  });
}
function renderContent():void {
  $('#source-title').textContent=state.tracker.sourceName||'No workbook loaded';
  $('#source-path').textContent=state.tracker.sourceName?`Loaded from ${state.loadingFrom}`:'Open a tracker or connect a folder.';
  renderSheetTabs();renderNavigation();renderMeeting();renderStats();renderActions();renderTables();
}
export function render():void {renderContent();renderFilters();}
export function setupUI():void {
  $('#search-input').addEventListener('input',e=>{state.query=(e.target as HTMLInputElement).value;renderTables();});
  $('#urgent-only').addEventListener('change',e=>{urgentOnly=(e.target as HTMLInputElement).checked;renderTables();});
  $('#filter-add').addEventListener('click',()=>{state.filters.push({id:++filterSequence,field:'all',value:''});renderFilters();$('#filters').querySelector<HTMLInputElement>('input:last-of-type')?.focus();});
  $('#meeting-add').onclick=()=>{state.tracker.meeting.push({label:'New field',value:''});changed();renderContent();};
  $('#agenda-add').onclick=()=>{state.tracker.agenda.push({id:newId(),number:String(state.tracker.agenda.length+1),topic:'',attendee:'',time:'',urgent:false});changed();renderContent();};
  $('#delete-sheet').onclick=()=>{
    if (state.sheets.length <= 1) return;
    const name=sheetLabel(state.tracker,state.activeSheet);
    if (!window.confirm(`Delete weekly sheet ${name}? This removes its data from the current workspace and auto-saved draft. This removes the worksheet from the original Excel workbook when auto-save completes.`)) return;
    if (!deleteSheet(state.activeSheet)) return;
    hideDetails();render();
  };
  const sections=document.querySelectorAll<HTMLElement>('.content-section');
  const observer=new IntersectionObserver(entries=>{
    const visible=entries.filter(e=>e.isIntersecting).sort((a,b)=>a.boundingClientRect.top-b.boundingClientRect.top);
    if(visible[0]){activeSection=visible[0].target.id;highlightNavigation();}
  },{rootMargin:'-105px 0px -60% 0px',threshold:0});
  sections.forEach(s=>observer.observe(s));render();
}
export function setSaved():void {state.dirty=false;}
export function notify(message:string,error=false):void {
  if(toastTimer)clearTimeout(toastTimer);
  const el=$('#toast');el.hidden=false;el.textContent=message;el.classList.toggle('toast-error',error);
  el.onclick=()=>{el.hidden=true;if(toastTimer)clearTimeout(toastTimer);};
  toastTimer=window.setTimeout(()=>{el.hidden=true;},error?4500:1200);
}
