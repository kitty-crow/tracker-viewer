import { bullet, FIELDS, HEADERS, lines, newId, newProject, type Field, type MiscItem, type NoteField, type Project, type Section } from './types';
import { changed, state } from './state';
const $ = <T extends HTMLElement>(selector: string): T => document.querySelector<T>(selector)!;
const html = (text: unknown): string => String(text ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
const NAMES: Record<Section | 'meeting', string> = { projects: 'Projects & enquiries', regional: 'Middle East region', misc: 'Miscellaneous', meeting: 'Meeting details' };
const isProject = (value: Project | MiscItem): value is Project => 'client' in value;
let urgentOnly = false;
let filterSequence = 1;

function sectionItems(section: Section): (Project | MiscItem)[] {
  return section === 'misc' ? state.tracker.misc : state.tracker.projects.filter(p => p.section === section);
}
function visibleItems(): (Project | MiscItem)[] {
  const items = [...sectionItems(state.section === 'meeting' ? 'projects' : state.section)];
  const search = state.query.toLowerCase().trim();
  const matching = items.filter(item => {
    if (urgentOnly && !item.urgent && !(isProject(item) ? item.urgentLines.overview.length || item.urgentLines.updates.length : item.urgentLines.length)) return false;
    if (search && !Object.values(item).some(value => typeof value === 'string' && value.toLowerCase().includes(search))) return false;
    return state.filters.every(filter => {
      if (!filter.value.trim()) return true;
      const query = filter.value.trim().toLowerCase();
      return filter.field === 'all'
        ? Object.values(item).some(value => typeof value === 'string' && value.toLowerCase().includes(query))
        : String(isProject(item) ? item[filter.field as Field] ?? '' : filter.field === 'notes' ? item.notes : filter.field === 'description' ? item.description : '').toLowerCase().includes(query);
    });
  });
  if (state.sort) {
    const { field, descending } = state.sort;
    matching.sort((a, b) => {
      const av = String(isProject(a) ? a[field as Field] ?? '' : field === 'notes' ? a.notes : a.description);
      const bv = String(isProject(b) ? b[field as Field] ?? '' : field === 'notes' ? b.notes : b.description);
      return (descending ? -1 : 1) * av.localeCompare(bv, undefined, { numeric: true, sensitivity: 'base' });
    });
  }
  return matching;
}
function notesMarkup(value: string, urgent: number[]): string {
  const list = lines(value);
  if (!list.length) return '<span class="empty-cell">Click to add notes</span>';
  return `<div class="note-preview">${list.slice(0, 3).map((line, i) => `<div class="note-item ${urgent.includes(i) ? 'is-urgent' : ''}">${html(line)}</div>`).join('')}${list.length > 3 ? `<span class="note-more">+${list.length - 3} more lines</span>` : ''}</div>`;
}
function projectRow(p: Project): string {
  return `<tr data-id="${html(p.id)}" class="${p.urgent ? 'row-urgent' : ''}">
  ${FIELDS.map(field => `<td data-field="${field}" class="${field === 'overview' || field === 'updates' ? 'note-cell' : ''}">${field === 'overview' || field === 'updates' ? notesMarkup(p[field], p.urgentLines[field]) : html(p[field]) || '<span class="empty-cell">Edit</span>'}</td>`).join('')}
  <td class="row-actions"><div class="row-action-buttons"><button type="button" data-action="urgent" data-id="${html(p.id)}" class="icon-button ${p.urgent ? 'selected-urgent' : ''}" title="${p.urgent ? 'Clear urgency' : 'Mark project urgent'}" aria-label="Toggle project urgency">!</button><button type="button" data-action="details" data-id="${html(p.id)}" class="icon-button" title="Edit individual notes and their urgency" aria-label="Manage notes">☷</button><button type="button" data-action="delete" data-id="${html(p.id)}" class="icon-button delete" title="Delete project" aria-label="Delete project">×</button></div></td></tr>`;
}
function miscRow(item: MiscItem): string {
  return `<tr data-id="${html(item.id)}" class="${item.urgent ? 'row-urgent' : ''}"><td data-field="description">${html(item.description) || '<span class="empty-cell">Edit</span>'}</td><td data-field="notes" class="note-cell">${notesMarkup(item.notes, item.urgentLines)}</td><td class="row-actions"><div class="row-action-buttons"><button class="icon-button ${item.urgent ? 'selected-urgent' : ''}" data-action="urgent" data-id="${html(item.id)}" title="Toggle urgency">!</button><button class="icon-button" data-action="details" data-id="${html(item.id)}" title="Manage notes">☷</button><button class="icon-button delete" data-action="delete" data-id="${html(item.id)}" title="Delete item">×</button></div></td></tr>`;
}
function renderNav(): void {
  $('#section-nav').innerHTML = (['projects', 'regional', 'misc', 'meeting'] as const).map((section, i) => {
    const count = section === 'meeting' ? state.tracker.meeting.length : sectionItems(section).length;
    return `<button type="button" class="nav-item ${state.section === section ? 'active' : ''}" data-section="${section}"><span class="nav-symbol">${['▦', '◈', '☷', '▤'][i]}</span><span>${NAMES[section]}</span><span class="nav-count">${count}</span></button>`;
  }).join('');
  $('#section-nav').querySelectorAll<HTMLButtonElement>('[data-section]').forEach(button => button.onclick = () => {
    state.section = button.dataset.section as Section | 'meeting'; state.selectedId = null; state.filters = []; state.sort = null; state.query = ''; urgentOnly = false;
    $('#search-input').setAttribute('value', ''); ($('#search-input') as HTMLInputElement).value = '';
    ($('#urgent-only') as HTMLInputElement).checked = false; hideDetails(); render();
  });
}
function renderStats(): void {
  const total = state.tracker.projects.filter(p => p.section === 'projects').length;
  const enquiries = state.tracker.projects.filter(p => p.section === 'projects' && /enquiry/i.test(p.projectNo)).length;
  const urgent = state.tracker.projects.filter(p => p.urgent || p.urgentLines.overview.length || p.urgentLines.updates.length).length + state.tracker.misc.filter(m => m.urgent || m.urgentLines.length).length;
  const regional = state.tracker.projects.filter(p => p.section === 'regional').length;
  $('#stats').innerHTML = [ ['Total projects & enquiries', total, '▦'], ['Enquiries', enquiries, '⌕'], ['Urgent items', urgent, '!'], ['Regional projects', regional, '◈'] ]
    .map(([label, count, icon]) => `<div class="stat"><span class="stat-icon">${icon}</span><div><div class="stat-value">${count}</div><div class="stat-name">${label}</div></div></div>`).join('');
}
function renderHeading(): void {
  const section = state.section;
  $('#page-title').textContent = NAMES[section]; $('#current-section').textContent = NAMES[section];
  $('#page-subtitle').textContent = section === 'meeting' ? 'Meeting information imported from your tracker. Click any value to edit.' : 'Click any cell to edit. Use the notes controls to flag individual lines as urgent.';
  $('#source-title').textContent = state.tracker.sourceName || 'No workbook loaded';
  $('#source-path').textContent = state.tracker.sourceName ? `Loaded from ${state.loadingFrom} · Excel workbook` : 'Open an .xlsx tracker or connect a folder to begin.';
  const container = $('#section-action');
  container.innerHTML = section === 'meeting' ? '<button class="button" id="add-meeting">+ Add field</button>' : `
    <button class="button ${state.tracker.urgentSections[section] ? 'selected-urgent' : ''}" id="urgent-section">! ${state.tracker.urgentSections[section] ? 'Clear section urgency' : 'Mark section urgent'}</button>
    ${section === 'projects' ? '<button class="button" id="new-enquiry">+ New enquiry</button><button class="button button-primary" id="new-project">+ New project</button>' : `<button class="button button-primary" id="new-item">+ New ${section === 'misc' ? 'note' : 'regional project'}</button>`}`;
  const urgentButton = container.querySelector<HTMLButtonElement>('#urgent-section');
  if (urgentButton) urgentButton.onclick = () => { state.tracker.urgentSections[section as Section] = !state.tracker.urgentSections[section as Section]; changed(); render(); };
  const add = (kind: 'project' | 'enquiry' | 'regional' | 'misc') => {
    if (kind === 'misc') state.tracker.misc.unshift({ id: newId(), description: '', notes: '', urgent: false, urgentLines: [] });
    else { const p = newProject(kind === 'regional' ? 'regional' : 'projects'); if (kind === 'enquiry') p.projectNo = 'Enquiry'; state.tracker.projects.unshift(p); }
    changed(); state.query = ''; state.filters = []; render();
    const target = $('#table-region').querySelector<HTMLElement>('tbody tr:first-child td[data-field]'); target?.click();
  };
  container.querySelector<HTMLButtonElement>('#new-project')?.addEventListener('click', () => add('project'));
  container.querySelector<HTMLButtonElement>('#new-enquiry')?.addEventListener('click', () => add('enquiry'));
  container.querySelector<HTMLButtonElement>('#new-item')?.addEventListener('click', () => add(section === 'misc' ? 'misc' : 'regional'));
  container.querySelector<HTMLButtonElement>('#add-meeting')?.addEventListener('click', () => { state.tracker.meeting.push({ label: 'New field', value: '' }); changed(); render(); });
  $('#save-status').textContent = state.dirty ? '● Unsaved changes' : 'All changes saved';
  $('#save-status').classList.toggle('dirty', state.dirty);
  $('#page-title').classList.toggle('is-urgent', section !== 'meeting' && state.tracker.urgentSections[section]);
}
function renderFilters(): void {
  const region = $('#filters');
  region.innerHTML = state.filters.map(filter => `<label class="filter-pill"><select aria-label="Field for filter" data-filter-id="${filter.id}" data-part="field">${(state.section === 'misc' ? ['all','description','notes'] : ['all', ...FIELDS]).map(f => `<option value="${f}" ${f === filter.field ? 'selected' : ''}>${f === 'all' ? 'Any field' : f === 'description' ? 'Description' : f === 'notes' ? 'Notes' : HEADERS[f as Field]}</option>`).join('')}</select><input data-filter-id="${filter.id}" data-part="value" value="${html(filter.value)}" aria-label="Filter value" placeholder="Contains…" /><button class="filter-remove" data-remove-filter="${filter.id}" title="Remove filter">×</button></label>`).join('');
  region.querySelectorAll<HTMLSelectElement>('select').forEach(el => el.onchange = () => { const f = state.filters.find(x => x.id === Number(el.dataset.filterId)); if (f) f.field = el.value as typeof f.field; renderTable(); });
  region.querySelectorAll<HTMLInputElement>('input').forEach(el => el.oninput = () => { const f = state.filters.find(x => x.id === Number(el.dataset.filterId)); if (f) f.value = el.value; renderTable(); });
  region.querySelectorAll<HTMLButtonElement>('[data-remove-filter]').forEach(el => el.onclick = () => { state.filters = state.filters.filter(x => x.id !== Number(el.dataset.removeFilter)); renderFilters(); renderTable(); });
}
function renderMeeting(): void {
  $('#result-count').textContent = `${state.tracker.meeting.length} fields`;
  $('#table-region').innerHTML = `<table class="data-table meeting-table"><thead><tr><th>Field</th><th>Value</th><th></th></tr></thead><tbody>${state.tracker.meeting.map((m, i) => `<tr data-meeting="${i}"><td data-field="label">${html(m.label)}</td><td data-field="value">${html(m.value) || '<span class="empty-cell">Edit</span>'}</td><td class="row-actions"><button class="icon-button delete" data-delete-meeting="${i}" title="Remove field">×</button></td></tr>`).join('')}</tbody></table>`;
  $('#table-region').querySelectorAll<HTMLElement>('td[data-field]').forEach(el => el.onclick = () => editCell(el));
  $('#table-region').querySelectorAll<HTMLButtonElement>('[data-delete-meeting]').forEach(el => el.onclick = () => { state.tracker.meeting.splice(Number(el.dataset.deleteMeeting), 1); changed(); render(); });
}
function renderTable(): void {
  if (state.section === 'meeting') { renderMeeting(); return; }
  const items = visibleItems();
  $('#result-count').textContent = `${items.length} of ${sectionItems(state.section).length} items`;
  const fields = state.section === 'misc' ? ['description', 'notes'] : [...FIELDS];
  const header = fields.map(field => `<th><button class="sort-button" data-sort="${field}">${html(field === 'description' ? 'Description' : field === 'notes' ? 'Notes' : HEADERS[field as Field])}${state.sort?.field === field ? (state.sort.descending ? ' ↓' : ' ↑') : ''}</button></th>`).join('');
  $('#table-region').innerHTML = `<table class="data-table ${state.section === 'misc' ? 'misc-table' : ''}"><thead><tr>${header}<th class="actions-heading">Actions</th></tr></thead><tbody>${items.map(item => isProject(item) ? projectRow(item) : miscRow(item)).join('')}</tbody></table>${items.length ? '' : '<div class="empty-state"><div>▤</div><strong>No matching items</strong><p>Try clearing filters or add a new item.</p></div>'}`;
  $('#table-region').querySelectorAll<HTMLElement>('td[data-field]').forEach(el => el.onclick = () => editCell(el));
  $('#table-region').querySelectorAll<HTMLButtonElement>('[data-sort]').forEach(el => el.onclick = () => { const field = el.dataset.sort as Field | 'description' | 'notes'; state.sort = { field, descending: state.sort?.field === field ? !state.sort.descending : false }; renderTable(); });
  $('#table-region').querySelectorAll<HTMLButtonElement>('[data-action]').forEach(el => el.onclick = () => {
    const id = el.dataset.id!; const kind = el.dataset.action;
    const item = [...state.tracker.projects, ...state.tracker.misc].find(x => x.id === id);
    if (!item) return;
    if (kind === 'urgent') { item.urgent = !item.urgent; changed(); render(); }
    if (kind === 'details') { state.selectedId = id; showDetails(item); }
    if (kind === 'delete' && window.confirm(`Delete ${isProject(item) ? item.well || item.client || 'this project' : item.description || 'this note'}?`)) {
      state.tracker.projects = state.tracker.projects.filter(p => p.id !== id);
      state.tracker.misc = state.tracker.misc.filter(m => m.id !== id);
      changed(); hideDetails(); render();
    }
  });
}
function editCell(cell: HTMLElement): void {
  if (cell.querySelector('input,textarea')) return;
  const meetingIndex = cell.closest<HTMLTableRowElement>('[data-meeting]')?.dataset.meeting;
  const record = cell.closest<HTMLTableRowElement>('tr[data-id]');
  const item = record ? [...state.tracker.projects, ...state.tracker.misc].find(x => x.id === record.dataset.id) : null;
  const field = cell.dataset.field!;
  const target = meetingIndex === undefined ? item as unknown as Record<string, string> : state.tracker.meeting[Number(meetingIndex)] as unknown as Record<string, string>;
  if (!target) return;
  const original = String(target[field] ?? '');
  const multiline = field === 'overview' || field === 'updates' || field === 'notes' || (field === 'value' && original.includes('\n'));
  const control = document.createElement(multiline ? 'textarea' : 'input');
  if (control instanceof HTMLInputElement) control.type = 'text';
  control.className = 'cell-editor'; control.value = original;
  control.setAttribute('aria-label', `Edit ${field}`);
  if (multiline) { (control as HTMLTextAreaElement).rows = Math.max(4, Math.min(16, lines(original).length + 2)); }
  let cancelled = false;
  function commit(): void {
    if (!cell.contains(control)) return;
    if (!cancelled && target[field] !== control.value) { target[field] = control.value; changed(); }
    renderHeading(); renderStats(); renderTable();
  }
  control.addEventListener('keydown', event => {
    const keyboard = event as KeyboardEvent;
    if (keyboard.key === 'Escape') { cancelled = true; control.blur(); return; }
    if (keyboard.key === 'Enter' && !multiline) { event.preventDefault(); control.blur(); return; }
    if (keyboard.key === 'Enter' && multiline && !keyboard.shiftKey && !keyboard.ctrlKey) {
      event.preventDefault(); const start = control.selectionStart ?? 0; const end = control.selectionEnd ?? start;
      const prefix = '\n• ';
      control.setRangeText(prefix, start, end, 'end');
    }
  });
  control.addEventListener('blur', commit, { once: true });
  cell.replaceChildren(control); control.focus();
  if (!multiline) control.select();
}
function hideDetails(): void { const panel = $('#details'); panel.hidden = true; state.selectedId = null; }
function showDetails(item: Project | MiscItem): void {
  const panel = $('#details'); panel.hidden = false;
  const fields: { field: NoteField | 'notes'; label: string; text: string; urgent: number[] }[] = isProject(item)
    ? [{ field: 'overview', label: 'Overview', text: item.overview, urgent: item.urgentLines.overview }, { field: 'updates', label: 'Updates', text: item.updates, urgent: item.urgentLines.updates }]
    : [{ field: 'notes', label: 'Notes', text: item.notes, urgent: item.urgentLines }];
  panel.innerHTML = `<div class="details-heading"><div><span class="eyebrow">ITEM DETAILS</span><h2>${html(isProject(item) ? item.well || item.client || 'New project' : item.description || 'New note')}</h2></div><button class="icon-button" id="close-details" title="Close details">×</button></div><p class="details-hint">Mark any individual note line as urgent to display it in red. Edit text directly or add another bullet.</p>` +
    fields.map(data => `<div class="details-group"><h3>${data.label} <span>${lines(data.text).length} lines</span></h3><div class="detail-lines" data-detail-field="${data.field}">${lines(data.text).map((line, i) => `<div class="detail-line"><button class="icon-button ${data.urgent.includes(i) ? 'selected-urgent' : ''}" data-note-urgent="${i}" title="Toggle line urgency">!</button><textarea rows="2" data-note-line="${i}">${html(line)}</textarea><button class="icon-button delete" data-note-delete="${i}" title="Delete line">×</button></div>`).join('')}</div><button class="button add-line" data-add-line="${data.field}">+ Add bullet</button></div>`).join('');
  panel.querySelector<HTMLButtonElement>('#close-details')!.onclick = hideDetails;
  panel.querySelectorAll<HTMLElement>('[data-detail-field]').forEach(group => {
    const field = group.dataset.detailField as NoteField | 'notes';
    const urgency = () => isProject(item) ? item.urgentLines[field as NoteField] : item.urgentLines;
    const update = (arr: string[], urgent: number[]): void => {
      if (isProject(item)) { item[field as NoteField] = arr.join('\n'); item.urgentLines[field as NoteField] = urgent; }
      else { item.notes = arr.join('\n'); item.urgentLines = urgent; }
      changed(); renderHeading(); renderStats(); renderTable(); showDetails(item);
    };
    group.querySelectorAll<HTMLButtonElement>('[data-note-urgent]').forEach(button => button.onclick = () => {
      const index = Number(button.dataset.noteUrgent); const set = new Set(urgency());
      if (set.has(index)) set.delete(index); else set.add(index);
      update(lines(isProject(item) ? item[field as NoteField] : item.notes), [...set]);
    });
    group.querySelectorAll<HTMLButtonElement>('[data-note-delete]').forEach(button => button.onclick = () => {
      const index = Number(button.dataset.noteDelete); const arr = lines(isProject(item) ? item[field as NoteField] : item.notes);
      arr.splice(index, 1); update(arr, urgency().filter(i => i !== index).map(i => i > index ? i - 1 : i));
    });
    group.querySelectorAll<HTMLTextAreaElement>('[data-note-line]').forEach(area => area.onchange = () => {
      const index = Number(area.dataset.noteLine); const arr = lines(isProject(item) ? item[field as NoteField] : item.notes);
      arr[index] = area.value; update(arr, urgency());
    });
  });
  panel.querySelectorAll<HTMLButtonElement>('[data-add-line]').forEach(button => button.onclick = () => {
    const field = button.dataset.addLine as NoteField | 'notes';
    if (isProject(item)) item[field as NoteField] += `${item[field as NoteField] ? '\n' : ''}${bullet('New note')}`;
    else item.notes += `${item.notes ? '\n' : ''}${bullet('New note')}`;
    changed(); renderTable(); renderHeading(); showDetails(item);
    const last = panel.querySelector<HTMLTextAreaElement>(`[data-detail-field="${field}"] textarea:last-of-type`); last?.focus(); last?.select();
  });
}
export function render(): void {
  renderNav(); renderHeading(); renderStats(); renderFilters(); renderTable();
  $('#filter-add').hidden = state.section === 'meeting';
  $('#urgent-only').closest('label')!.classList.toggle('invisible', state.section === 'meeting');
}
export function setupUI(): void {
  $('#search-input').addEventListener('input', e => { state.query = (e.target as HTMLInputElement).value; renderTable(); });
  $('#urgent-only').addEventListener('change', e => { urgentOnly = (e.target as HTMLInputElement).checked; renderTable(); });
  $('#filter-add').addEventListener('click', () => { state.filters.push({ id: filterSequence++, field: 'all', value: '' }); renderFilters(); $('#filters').querySelector<HTMLInputElement>('input:last-of-type')?.focus(); });
  render();
}
export function setSaved(): void { state.dirty = false; renderHeading(); }
export function notify(message: string, error = false): void {
  const toast = $('#toast'); toast.hidden = false; toast.textContent = message;
  toast.classList.toggle('toast-error', error);
  // Do not couple UI lifecycle to a background request or network.
  toast.onclick = () => { toast.hidden = true; };
}
