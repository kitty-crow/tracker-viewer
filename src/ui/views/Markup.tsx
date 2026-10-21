import type { ReactNode } from 'react';
import { FIELDS, HEADERS, lines, sheetLabel, type Field, type NoteField, type MiscItem, type Project, type Section, type AgendaItem } from '../../model/TrackerTypes';
import { state, type Filter } from '../../model/TrackerState';
import { workbookLabel } from '../../files/WorkbookFolder';
import type { DiffKind, DiffLine, DiffReport, DiffSection } from '../../comparison/TrackerDiff';

/**
 * Declarative markup for the interactive tracker. All cells and attributes are
 * React elements rather than HTML strings, so imported spreadsheet text is
 * safely escaped by renderToStaticMarkup before we attach DOM listeners.
 *
 * These are intentionally pure views: event handling, filtering, persistence
 * and workbook mutation belong to TrackerView and TrackerApplication.
 */

export type TrackerItem = Project | MiscItem;
export const isProject = (item: TrackerItem): item is Project => 'client' in item;
export const SECTION_NAME: Record<Section, string> = {
  projects: 'Projects & enquiries', regional: 'Middle East region', misc: 'Miscellaneous',
};
export const SECTIONS: Section[] = ['projects', 'regional', 'misc'];

function EmptyCell(): ReactNode {
  return <span className="empty-cell">Edit</span>;
}

/** Read-only preview of the first four bullet lines in a spreadsheet cell. */
export function NotePreview({ value, urgent }: { value: string; urgent: number[] }): ReactNode {
  const all = lines(value);
  if (!all.length) return <EmptyCell />;
  return <div className="note-preview">
    {all.slice(0, 4).map((line, index) =>
      <div key={index} className={`note-item ${urgent.includes(index) ? 'is-urgent' : ''}`}>{line}</div>)}
    {all.length > 4 ? <span className="note-more">+{all.length - 4} more</span> : null}
  </div>;
}

/** Action controls are identical for ordinary and miscellaneous rows. */
function RowActions({ item }: { item: TrackerItem }): ReactNode {
  return <td className="row-actions"><div className="row-action-buttons">
    <button type="button" className={`icon-button ${item.urgent ? 'selected-urgent' : ''}`} data-action="urgent" title="Toggle urgency">!</button>
    <button type="button" className="icon-button" data-action="details" title="Edit note lines">☷</button>
    <button type="button" className="icon-button delete" data-action="delete" title="Delete">×</button>
  </div></td>;
}

/** One editable row; special note columns preserve bullet and urgency styling. */
function DataRow({ item }: { item: TrackerItem }): ReactNode {
  if (!isProject(item)) return <tr data-id={item.id} className={item.urgent ? 'row-urgent' : ''}>
    <td data-field="description">{item.description || <EmptyCell />}</td>
    <td className="note-cell" data-field="notes"><NotePreview value={item.notes} urgent={item.urgentLines} /></td>
    <RowActions item={item} />
  </tr>;
  return <tr data-id={item.id} className={item.urgent ? 'row-urgent' : ''}>
    {FIELDS.map(field => {
      const note = field === 'overview' || field === 'updates';
      return <td key={field} data-field={field} className={note ? 'note-cell' : ''}>
        {note ? <NotePreview value={item[field]} urgent={item.urgentLines[field as NoteField]} /> : item[field] || <EmptyCell />}
      </td>;
    })}
    <RowActions item={item} />
  </tr>;
}

/** The count and icon in the navigation are kept beside the section anchor. */
export function NavigationView({ active, counts }: { active: string; counts: Record<string, number> }): ReactNode {
  const definitions = [
    { id: 'meeting', title: 'Meeting & agenda', icon: '▤' },
    { id: 'projects', title: SECTION_NAME.projects, icon: '▦' },
    { id: 'regional', title: SECTION_NAME.regional, icon: '◈' },
    { id: 'misc', title: SECTION_NAME.misc, icon: '☷' },
  ];
  return <>{definitions.map(item => <a key={item.id} href={`#${item.id}`}
    className={`nav-item ${active === item.id ? 'active' : ''}`} data-nav={item.id}>
    <span className="nav-symbol">{item.icon}</span>
    <span>{item.title}</span>
    <span className="nav-count">{counts[item.id] ?? 0}</span>
  </a>)}</>;
}

/** Workbook tabs identify files; worksheet tabs identify sheets inside a file. */
export function SheetTabsView(): ReactNode {
  const files = [...state.folderFiles].sort((a, b) =>
    a.filename.localeCompare(b.filename, undefined, { numeric: true, sensitivity: 'base' }));
  const worksheets = state.sheets;
  return <>
    {files.length > 0 ? <div className="workbook-tabs" role="group"
      aria-label={state.diffMode ? 'Choose two weeks to compare' : 'Excel files in tracker folder'}>
      {files.map(file => {
        const position = state.diffSelected.indexOf(file.filename);
        const selecting = state.diffMode && position >= 0;
        const active = !state.diffMode && Boolean(state.sourceSignature) && file.filename === state.tracker.sourceName;
        const role = selecting ? position === 0 ? 'From' : 'To' : '';
        return <button key={file.filename} type="button"
          className={`sheet-tab ${active ? 'active' : ''} ${selecting ? position === 0 ? 'diff-from-selected' : 'diff-to-selected' : ''}`}
          data-folder-file={file.filename} title={file.filename}
          aria-pressed={selecting} aria-current={active ? 'page' : 'false'}>
          {workbookLabel(file.filename)}
          {active ? <> <span className="sheet-current">●</span></> : null}
          {role ? <> <span className="diff-pill-role">{role}</span></> : null}
        </button>;
      })}
    </div> : null}
    {!state.diffMode && (worksheets.length > 1 || files.length === 0) ?
      <div className="worksheet-tabs" role="group" aria-label="Worksheets in selected Excel file">
        {worksheets.map((sheet, index) => <button key={index} type="button"
          className={`sheet-tab ${index === state.activeSheet ? 'active' : ''}`} data-sheet={index}>
          {sheetLabel(sheet, index)}
          {index === state.activeSheet ? <> <span className="sheet-current">●</span></> : null}
        </button>)}
      </div> : null}
  </>;
}

export type DiffSide = 'from' | 'to';

/** Read-only worksheet selector. It does not mutate the active editable sheet. */
function SheetChoice({ side, filename, sheets, selected }: {
  side: DiffSide; filename: string; sheets: typeof state.sheets; selected: number;
}): ReactNode {
  return <div className="diff-choice">
    <span className="diff-choice-label">{side === 'from' ? 'FROM · BASELINE' : 'TO · COMPARE'}</span>
    <strong title={filename}>{filename}</strong>
    {sheets.length > 1 ? <label>Worksheet <select className="diff-sheet-select"
      data-diff-side={side} aria-label={`${side === 'from' ? 'Baseline' : 'Comparison'} worksheet`}
      defaultValue={String(selected)}>
      {sheets.map((sheet, index) => <option value={index} key={index}>{sheetLabel(sheet, index)}</option>)}
    </select></label> : null}
  </div>;
}

/** Either render the selected comparison pair or explain which file is needed. */
export function DiffChoicesView(): ReactNode {
  const selected = state.diffSelected;
  const old = state.diffWorkbooks.find(item => item.filename === selected[0]);
  const next = state.diffWorkbooks.find(item => item.filename === selected[1]);
  if (!old || !next) return <p className="diff-await-selection">
    {selected.length ? `From: ${selected[0]} — select the second week.` : 'Select your first week from the pills above.'}
  </p>;
  return <>
    <SheetChoice side="from" filename={old.filename} sheets={old.sheets} selected={state.diffFromSheet} />
    <span className="diff-direction" aria-hidden="true">→</span>
    <SheetChoice side="to" filename={next.filename} sheets={next.sheets} selected={state.diffToSheet} />
  </>;
}

const diffSections: DiffSection[] = [
  'Projects & enquiries', 'Middle East region', 'Miscellaneous', 'Agenda', 'Meeting details',
];
const diffSectionIds: Record<DiffSection, string> = {
  'Projects & enquiries': 'projects', 'Middle East region': 'regional',
  'Miscellaneous': 'misc', 'Agenda': 'agenda', 'Meeting details': 'meeting',
};
const diffKindNames: Record<DiffKind, string> = { added: 'Added', removed: 'Removed', changed: 'Changed' };

/** A single before/after field change with a sign and original value. */
function DiffLineView({ line }: { line: DiffLine }): ReactNode {
  return <div className={`diff-line ${line.sign === '+' ? 'diff-plus' : 'diff-minus'}`}>
    <span className="diff-prefix">{line.sign}</span>
    <span className="diff-field">{line.field}</span>
    <span className="diff-value">{line.value}</span>
  </div>;
}

/** Precomputed comparison results grouped into the tracker sections. */
export function DiffReportView({ report }: { report: DiffReport }): ReactNode {
  return <>
    <div className="diff-summary" aria-label="Diff summary">
      <span className="diff-summary-item diff-sum-added">+{report.added} added</span>
      <span className="diff-summary-item diff-sum-removed">−{report.removed} removed</span>
      <span className="diff-summary-item diff-sum-changed">~{report.changed} changed</span>
    </div>
    {report.entries.length === 0 ? <p className="diff-no-changes">No content changes found between these weeks.</p> : null}
    {diffSections.map(section => {
      const entries = report.entries.filter(entry => entry.section === section);
      if (!entries.length) return null;
      return <section key={section} className="diff-group" id={`diff-group-${diffSectionIds[section]}`}>
        <h3>{section} <span>{entries.length} change{entries.length === 1 ? '' : 's'}</span></h3>
        {entries.map((entry, index) => <article key={index} className={`diff-entry diff-entry-${entry.kind}`}>
          <div className="diff-entry-header"><span className="diff-entry-kind">{diffKindNames[entry.kind]}</span><strong>{entry.title}</strong></div>
          <div className="diff-entry-lines">{entry.lines.length ?
            entry.lines.map((line, i) => <DiffLineView key={i} line={line} />) :
            <div className="diff-line">Entry added or removed</div>}</div>
        </article>)}
      </section>;
    })}
  </>;
}

/** A status message for loading, validation failures or a missing sheet. */
export function DiffStatusView({ message, failed = false }: { message: string; failed?: boolean }): ReactNode {
  return <p className={failed ? 'diff-failure' : 'diff-await-selection'}>{message}</p>;
}

/** Small overview cards displayed above the project tables. */
export function StatsView({ urgent }: { urgent: number }): ReactNode {
  const projects = state.tracker.projects;
  const stats: [string, number, string][] = [
    ['Projects & enquiries', projects.filter(p => p.section === 'projects').length, '▦'],
    ['Enquiries', projects.filter(p => /enquiry/i.test(p.projectNo)).length, '⌕'],
    ['Urgent items', urgent, '!'],
    ['Regional projects', projects.filter(p => p.section === 'regional').length, '◈'],
  ];
  return <>{stats.map(([label, count, icon]) => <div key={label} className="stat">
    <span className="stat-icon">{icon}</span>
    <div><div className="stat-value">{count}</div><div className="stat-name">{label}</div></div>
  </div>)}</>;
}

/** Meeting metadata use stable wrappers to prevent editing from reflowing. */
export function MeetingFieldsView(): ReactNode {
  return <>{state.tracker.meeting.map((item, index) =>
    <div className="meeting-pair" data-meeting={index} key={index}>
      <label data-field="label">{item.label}</label>
      <div className="meeting-value" data-field="value">{item.value || <EmptyCell />}</div>
      <button type="button" className="icon-button delete" title="Delete field" data-delete-meeting={index}>×</button>
    </div>)}</>;
}

/** Agenda rows expose data attributes for edit and urgency event delegation. */
export function AgendaView(): ReactNode {
  const fields: (keyof AgendaItem)[] = ['number', 'topic', 'attendee', 'time'];
  return <div className="agenda-list" role="list" aria-label="Agenda items">
    <div className="agenda-row agenda-row-head" aria-hidden="true">
      <span>No</span><span>Topic</span><span>Attendee</span><span>Time</span><span></span>
    </div>
    {state.tracker.agenda.map(item =>
      <div role="listitem" className={`agenda-row ${item.urgent ? 'row-urgent' : ''}`} data-agenda={item.id} key={item.id}>
        {fields.map(field => <div key={field} className={`agenda-field agenda-${field}`}
          data-field={field} title={`Click to edit ${field}`}>
          {item[field] || <EmptyCell />}
        </div>)}
        <div className="agenda-controls">
          <button type="button" className={`icon-button ${item.urgent ? 'selected-urgent' : ''}`}
            data-agenda-action="urgent" title="Toggle urgency" aria-label="Mark agenda item urgent">!</button>
          <button type="button" className="icon-button delete" data-agenda-action="delete"
            title="Delete agenda item" aria-label="Delete agenda item">×</button>
        </div>
      </div>)}
  </div>;
}

/** The nine project columns are now sized in styles/tables.css, not inline. */
export function TableView({ section, items }: { section: Section; items: TrackerItem[] }): ReactNode {
  const fields: string[] = section === 'misc' ? ['description', 'notes'] : [...FIELDS];
  return <>
    <table className={`data-table ${section === 'misc' ? 'misc-table' : ''}`}>
      <colgroup>{Array.from({ length: fields.length + 1 }, (_, i) => <col key={i} />)}</colgroup>
      <thead><tr>
        {fields.map(field => <th key={field}><button type="button" className="sort-button" data-sort={field}>
          {field === 'description' ? 'Description' : field === 'notes' ? 'Notes' : HEADERS[field as Field]}
          {state.sort?.field === field ? state.sort.descending ? ' ↓' : ' ↑' : ''}
        </button></th>)}
        <th className="actions-heading">Actions</th>
      </tr></thead>
      <tbody>{items.map(item => <DataRow item={item} key={item.id} />)}</tbody>
    </table>
    {!items.length ? <div className="empty-state">No matching items</div> : null}
  </>;
}

/** New-entry and section urgency buttons vary only by section. */
export function SectionActionsView({ section }: { section: Section }): ReactNode {
  const urgent = state.tracker.urgentSections[section];
  return <>
    <button type="button" className={`button ${urgent ? 'selected-urgent' : ''}`}
      data-section-urgent={section}>! {urgent ? 'Clear urgent' : 'Urgent'}</button>
    {section === 'projects' ? <>
      <button type="button" className="button" data-add="enquiry">+ Enquiry</button>
      <button type="button" className="button button-primary" data-add="project">+ Project</button>
    </> : <button type="button" className="button button-primary" data-add={section}>
      + {section === 'misc' ? 'Note' : 'Project'}
    </button>}
  </>;
}

/** Controlled by TrackerView: field filters are updated as the user types. */
export function FiltersView({ filters }: { filters: Filter[] }): ReactNode {
  const fields = [...FIELDS, 'description', 'notes'];
  return <>{filters.map(filter => <label className="filter-pill" key={filter.id}>
    <select data-filter={filter.id} data-part="field" aria-label="Filter field" defaultValue={filter.field}>
      <option value="all">Any field</option>
      {fields.map(field => <option value={field} key={field}>
        {field === 'notes' ? 'Notes' : field === 'description' ? 'Description' : HEADERS[field as Field]}
      </option>)}
    </select>
    <input data-filter={filter.id} data-part="value" defaultValue={filter.value}
      placeholder="Contains…" aria-label="Filter value" />
    <button type="button" className="filter-remove" data-remove={filter.id} title="Remove filter">×</button>
  </label>)}</>;
}

export interface DetailsGroup {
  field: 'overview' | 'updates' | 'notes';
  label: string;
  text: string;
  urgent: number[];
}

/** Editor sidebar. Input contents are escaped by React including textareas. */
export function DetailsView({ item, groups }: { item: TrackerItem; groups: DetailsGroup[] }): ReactNode {
  return <>
    <div className="details-heading">
      <div><span className="eyebrow">NOTES</span>
        <h2>{isProject(item) ? item.well || item.client || 'Project' : item.description || 'Note'}</h2></div>
      <button type="button" className="icon-button" id="close-details">×</button>
    </div>
    {groups.map(group => <div className="details-group" data-detail={group.field} key={group.field}>
      <h3>{group.label} <span>{lines(group.text).length} lines</span></h3>
      {lines(group.text).map((value, index) => <div className="detail-line" key={index}>
        <button type="button" className={`icon-button ${group.urgent.includes(index) ? 'selected-urgent' : ''}`}
          data-urgent-line={index}>!</button>
        <textarea data-edit-line={index} rows={2} defaultValue={value} />
        <button type="button" className="icon-button delete" data-delete-line={index}>×</button>
      </div>)}
      <button type="button" className="button add-line" data-add-line={group.field}>+ Bullet</button>
    </div>)}
  </>;
}
