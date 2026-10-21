/**
 * Converts between XLSX worksheets and editable tracker models while respecting cell formatting.
 *
 * Keep file-system, workbook, comparison and UI concerns separate: callers
 * rely on these interfaces to preserve the existing Excel editing workflow.
 */
import type ExcelJS from 'exceljs';
import { blankTracker, cleanText, FIELDS, HEADERS, lines, newId, newProject, type Field, type MiscItem, type NoteField, type Project, type Section, type Tracker } from '../model/TrackerTypes';
const getExcel = async () => { const mod = await import('exceljs/dist/exceljs.min.js'); return mod.default ?? mod; };
const val = (sheet: ExcelJS.Worksheet, row: number, col: number): string => {
  const c = sheet.getRow(row).getCell(col);
  if (c.isMerged && c.master?.address !== c.address) return '';
  return cleanText(c.value);
};
function cellAt(sheet: ExcelJS.Worksheet, row: number, col: number): ExcelJS.Cell {
  return sheet.getRow(row).getCell(col);
}
function redColour(c: Partial<ExcelJS.Color> | undefined): boolean {
  if (!c) return false;
  if ('argb' in c && c.argb) {
    const rgb = c.argb.slice(-6);
    const [r,g,b] = [0,2,4].map(i=>parseInt(rgb.slice(i,i+2),16));
    return (r ?? 0)>=125 && (r ?? 0)>(g ?? 0)*1.35 && (r ?? 0)>(b ?? 0)*1.18;
  }
  return 'indexed' in c && c.indexed===10;
}
function flaggedLines(cell: ExcelJS.Cell, text: string): number[] {
  const rich = cell.value as {richText?: {text:string;font?:{color?:ExcelJS.Color}}[]}|null;
  const visible = lines(text);
  if (!visible.length) return [];
  if (redColour(cell.font?.color)) return visible.map((_,i)=>i);
  if (!rich || !Array.isArray(rich.richText)) return [];
  const red = new Set<number>(); let offset=0;
  const actual = text.split(/\r?\n/);
  for (const chunk of rich.richText) {
    const begin=offset;
    offset+=chunk.text.length;
    if (!redColour(chunk.font?.color)) continue;
    for (let i=begin;i<offset;i++) {
      const lineIndex=text.slice(0,Math.min(i,text.length)).split('\n').length-1;
      if (actual[lineIndex]?.trim()) red.add(actual.slice(0,lineIndex).filter(v=>v.trim()).length);
    }
  }
  return [...red].sort((a,b)=>a-b);
}
const key=(s:string)=>s.toLowerCase().replace(/[^a-z0-9]+/g,'');
const fieldFor=(heading:string): Field|undefined => ({priority:'priority',client:'client',customer:'client',country:'country',location:'country',projectno:'projectNo',projectnumber:'projectNo',jobno:'projectNo',enquiry:'projectNo',well:'well',wellproject:'well',project:'well',lead:'lead',owner:'lead',overview:'overview',scope:'overview',updates:'updates',update:'updates',notes:'updates'} as Record<string,Field>)[key(heading)];
function detectHeader(sheet:ExcelJS.Worksheet):{row:number;cols:Partial<Record<Field,number>>}|null {
  for(let r=1;r<=Math.min(sheet.rowCount,80);r++){
    const cols:Partial<Record<Field,number>>={};
    sheet.getRow(r).eachCell({includeEmpty:false},(cell,col)=>{const field=fieldFor(cleanText(cell.value));if(field&&cols[field]===undefined)cols[field]=col;});
    if(cols.client&&(cols.projectNo||cols.well)&&(cols.overview||cols.updates))return {row:r,cols};
  }
  return null;
}
function markers(sheet:ExcelJS.Worksheet):{regional:number;misc:number} {
  const out={regional:0,misc:0};
  for(let r=1;r<=sheet.rowCount;r++){
    let text='';sheet.getRow(r).eachCell({includeEmpty:false},cell=>{text+=' '+cleanText(cell.value);});
    if(!out.regional&&/middle east region/i.test(text))out.regional=r;
    if(!out.misc&&/miscellaneous/i.test(text))out.misc=r;
  }
  return out;
}
function putNote(item:Project,field:NoteField,text:string,red:boolean):void {
  if(!text.trim())return;
  const offset=lines(item[field]).length;
  item[field]+=(item[field]?'\n':'')+text;
  if(red)item.urgentLines[field].push(...lines(text).map((_,i)=>i+offset));
}
function parseTable(sheet:ExcelJS.Worksheet,header:{row:number;cols:Partial<Record<Field,number>>},end:number,section:'projects'|'regional',dest:Project[]):void {
  for(let r=header.row+1;r<end;r++){
    const p=newProject(section);
    for(const f of FIELDS){const col=header.cols[f];if(col)p[f]=val(sheet,r,col);}
    if(!p.client.trim()&&!p.projectNo.trim()&&!p.well.trim())continue;
    for(const f of FIELDS){const col=header.cols[f];if(!col)continue;const red=flaggedLines(cellAt(sheet,r,col),p[f]);
      if(f==='overview'||f==='updates')p.urgentLines[f]=red;
      if(f!=='overview'&&f!=='updates'&&red.length)p.urgent=true;
    }
    p._original = { sheet: sheet.name, cells: Object.fromEntries(FIELDS.flatMap(f => {
      const col = header.cols[f];
      return col ? [[f, cellAt(sheet, r, col).address]] : [];
    })) };
    dest.push(p);
  }
}
function parseRegional(sheet:ExcelJS.Worksheet,start:number,end:number,dest:Project[]):void {
  let current:Project|null=null;let updates=false;
  for(let r=start;r<end;r++){
    const client=val(sheet,r,3).trim();const note=val(sheet,r,7).trim();
    if(client&&!/^(no\.?|client)$/i.test(client)){
      current=newProject('regional');current.client=client;current.country=val(sheet,r,4);current.projectNo=val(sheet,r,5);
      current.well=val(sheet,r,6)||note;current.lead=val(sheet,r,8);current.priority=val(sheet,r,2);
      current.urgent=[2,3,4,5,6,8].some(c=>flaggedLines(cellAt(sheet,r,c),val(sheet,r,c)).length>0);
      dest.push(current);updates=false;
      const extraNote=val(sheet,r,6)&&note ? note : '';
      putNote(current,'overview',extraNote,flaggedLines(cellAt(sheet,r,7),extraNote).length>0);
      continue;
    }
    if(!current||!note)continue;
    if(/^updates?:?$/i.test(note)){updates=true;continue;}
    putNote(current,updates?'updates':'overview',note,flaggedLines(cellAt(sheet,r,7),note).length>0);
  }
}
function parseMisc(sheet:ExcelJS.Worksheet,start:number,end:number,dest:MiscItem[]):void {
  let current:MiscItem|null=null;
  for(let r=start;r<end;r++){
    const description=val(sheet,r,4).trim();const index=val(sheet,r,3).trim();
    if(/^description$/i.test(description))continue;
    if(index&&/^\d+$/.test(index)){
      current={id:newId(),description,notes:'',urgent:flaggedLines(cellAt(sheet,r,4),description).length>0,urgentLines:[]};dest.push(current);
      const notes=val(sheet,r,7);
      current.notes=notes;
      current.urgentLines=flaggedLines(cellAt(sheet,r,7),notes);
      continue;
    }
    if(current&&description){const offset=lines(current.notes).length;current.notes+=(current.notes?'\n':'')+description;
      current.urgentLines.push(...flaggedLines(cellAt(sheet,r,4),description).map(n=>n+offset));}
  }
}
function parseMeeting(sheet:ExcelJS.Worksheet,until:number,tracker:Tracker):void {
  for(let r=2;r<until;r++){
    const label=val(sheet,r,2).trim();
    if(!label||/^(meeting details|agenda|priority)$/i.test(label)||label.length>80)continue;
    tracker.meeting.push({label,value:val(sheet,r,4),_original:{sheet:sheet.name,cells:{label:cellAt(sheet,r,2).address,value:cellAt(sheet,r,4).address}}});
  }
  for(let r=1;r<until;r++){
    if(!/^no\.?$/i.test(val(sheet,r,3))||!/^topic$/i.test(val(sheet,r,4)))continue;
    for(let a=r+1;a<until;a++){
      const number=val(sheet,a,3).trim();if(!number)continue;
      tracker.agenda.push({id:newId(),number,topic:val(sheet,a,4),attendee:val(sheet,a,5),time:val(sheet,a,7)||val(sheet,a,6),urgent:[3,4,5,7].some(c=>flaggedLines(cellAt(sheet,a,c),val(sheet,a,c)).length>0),_original:{sheet:sheet.name,cells:{number:cellAt(sheet,a,3).address,topic:cellAt(sheet,a,4).address,attendee:cellAt(sheet,a,5).address,time:cellAt(sheet,a,val(sheet,a,7)?7:6).address}}});
    }
    break;
  }
}
function readWeekly(sheet:ExcelJS.Worksheet):Tracker|null {
  const tracker=blankTracker();const mark=markers(sheet);const head=detectHeader(sheet);
  if(!head&&!mark.regional&&!mark.misc)return null;
  if(head){parseTable(sheet,head,mark.regional||mark.misc||sheet.rowCount+1,'projects',tracker.projects);parseMeeting(sheet,head.row,tracker);}
  if(mark.regional)parseRegional(sheet,mark.regional+1,mark.misc||sheet.rowCount+1,tracker.projects);
  if(mark.misc)parseMisc(sheet,mark.misc+1,sheet.rowCount+1,tracker.misc);
  return tracker;
}
function readMeetingSheet(sheet: ExcelJS.Worksheet, tracker: Tracker): void {
  for (let row=2; row<=sheet.rowCount; row++) {
    const label = val(sheet,row,1);
    if (!label) continue;
    tracker.meeting.push({ label, value: val(sheet,row,2), _original: { sheet: sheet.name, cells: { label: cellAt(sheet,row,1).address, value: cellAt(sheet,row,2).address } } });
  }
}
function readMiscSheet(sheet: ExcelJS.Worksheet, tracker: Tracker): void {
  for (let row=2; row<=sheet.rowCount; row++) {
    const description=val(sheet,row,1);
    if (!description) continue;
    const notes=val(sheet,row,2);
    tracker.misc.push({id:newId(),description,notes,urgent:flaggedLines(cellAt(sheet,row,1),description).length>0,urgentLines:flaggedLines(cellAt(sheet,row,2),notes),_original:{sheet:sheet.name,cells:{description:cellAt(sheet,row,1).address,notes:cellAt(sheet,row,2).address}}});
  }
}
function readNormalised(sheet:ExcelJS.Worksheet,tracker:Tracker):void {
  if (/^meeting$/i.test(sheet.name)) { readMeetingSheet(sheet, tracker); return; }
  if (/^misc/i.test(sheet.name)) { readMiscSheet(sheet, tracker); return; }
  const header=detectHeader(sheet);
  if (!header) return;
  parseTable(sheet,header,sheet.rowCount+1,/middle east|regional/i.test(sheet.name)?'regional':'projects',tracker.projects);
}
function readMeta(book:ExcelJS.Workbook):unknown {
  const sheet=book.getWorksheet('_TrackerViewer');if(!sheet)return null;
  try {
    let text='';for(let r=2;r<=sheet.rowCount;r++)text+=val(sheet,r,1);
    return JSON.parse(text);
  }catch{return null;}
}
function mergeUrgency(target:Tracker,source:Tracker):void {
  target.urgentSections={...target.urgentSections,...source.urgentSections};
  target.projects.forEach((p,i)=>{const old=source.projects[i];if(!old)return;
    p.urgent=p.urgent||old.urgent;p.urgentLines.overview=[...new Set([...p.urgentLines.overview,...old.urgentLines.overview])];
    p.urgentLines.updates=[...new Set([...p.urgentLines.updates,...old.urgentLines.updates])];
  });
  target.misc.forEach((m,i)=>{const old=source.misc[i];if(old){m.urgent=m.urgent||old.urgent;m.urgentLines=[...new Set([...m.urgentLines,...old.urgentLines])];}});
  target.agenda.forEach((a,i)=>{a.urgent=a.urgent||Boolean(source.agenda[i]?.urgent);});
}
export async function importWorkbook(file:File):Promise<Tracker[]> {
  const Excel=await getExcel();const book=new Excel.Workbook();await book.xlsx.load(new Uint8Array(await file.arrayBuffer()) as never);
  const meta=readMeta(book) as {version?:number;sheets?:Tracker[];projects?:{urgent:boolean;urgentLines:Project['urgentLines']}[];misc?:{urgent:boolean;urgentLines:number[]}[];urgentSections?:Record<Section,boolean>}|null;
  const result:Tracker[]=[];let normalised:Tracker|null=null;
  for(const sheet of book.worksheets){
    if(sheet.name==='_TrackerViewer')continue;
    if(/^(projects|middle east|miscellaneous|meeting)$/i.test(sheet.name)){
      normalised ??= blankTracker();readNormalised(sheet,normalised);continue;
    }
    const tracker=readWeekly(sheet);
    if(tracker){tracker.sourceName=file.name;result.push(tracker);}
  }
  if(normalised&&(normalised.projects.length||normalised.misc.length||normalised.meeting.length))result.push(normalised);
  if(!result.length&&meta?.sheets?.length)result.push(...meta.sheets);
  if(!result.length)throw new Error('No recognisable project/enquiry tables were found in this workbook.');
  result.forEach((sheet,i)=>{sheet.sourceName=file.name;
    if(meta?.sheets?.[i])mergeUrgency(sheet,meta.sheets[i]);
  });
  if(meta&&!meta.sheets&&result.length===1){
    // result.length === 1 guarantees this element exists.
    const sheet=result[0]!;
    sheet.urgentSections={...sheet.urgentSections,...meta.urgentSections};
    meta.projects?.forEach((project,i)=>{
      const entry=sheet.projects[i];
      if (!entry) return;
      entry.urgent ||= Boolean(project.urgent);
      entry.urgentLines=project.urgentLines??entry.urgentLines;
    });
    meta.misc?.forEach((item,i)=>{
      const entry=sheet.misc[i];
      if (!entry) return;
      entry.urgent ||= Boolean(item.urgent);
      entry.urgentLines=item.urgentLines??entry.urgentLines;
    });
  }
  return result;
}
function header(cell:ExcelJS.Cell):void {
  cell.font={bold:true,color:{argb:'FFFFFFFF'},size:10};cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF1E3552'}};
  cell.alignment={vertical:'middle',wrapText:true};
}
function styledNotes(text:string,urgent:number[]):ExcelJS.CellRichTextValue|string {
  if(!urgent.length)return text;
  let visible=-1;
  return {richText:text.split('\n').map((t,i,all)=>{if(t.trim())visible++;return {text:t+(i===all.length-1?'':'\n'),font:{color:{argb:urgent.includes(visible)&&t.trim()?'FFD32842':'FF273C57'},bold:urgent.includes(visible)&&Boolean(t.trim())}};})};
}
function styleRow(row:ExcelJS.Row,index:number,urgent:boolean):void {
  row.eachCell({includeEmpty:true},cell=>{
    cell.alignment={vertical:'top',wrapText:true};
    cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:index%2===0?'FFF0F5FA':'FFFFFFFF'}};
    cell.border={bottom:{style:'hair',color:{argb:'FFDCE5ED'}}};
    if(urgent)cell.font={color:{argb:'FFCC2840'},bold:true};
  });
}
function writeWeekly(book:ExcelJS.Workbook,tracker:Tracker,index:number):void {
  const name=(tracker.meeting.find(m=>/meeting date( and time)?/i.test(m.label))?.value.match(/\d{1,2}\/\d{1,2}\/\d{4}|\d{4}-\d{2}-\d{2}/)?.[0]||`Week ${index+1}`).replace(/\//g,'-');
  let unique=name.slice(0,31),suffix=1;
  while(book.getWorksheet(unique))unique=`${name.slice(0,26)} (${++suffix})`;
  const sheet=book.addWorksheet(unique);sheet.views=[{state:'frozen',ySplit:1}];
  [5,13,18,20,28,24,60,60].forEach((width,i)=>{sheet.getColumn(i+2).width=width;});
  let r=2;sheet.getCell(r,2).value='MEETING DETAILS';header(sheet.getCell(r,2));r++;
  for(const m of tracker.meeting){sheet.getCell(r,2).value=m.label;sheet.getCell(r,4).value=m.value;sheet.getCell(r,2).font={bold:true,color:{argb:'FF304B65'}};sheet.getCell(r,4).alignment={wrapText:true};r++;}
  r++;sheet.getCell(r,3).value='AGENDA';header(sheet.getCell(r,3));r++;
  for(const [c,title] of [[3,'No'],[4,'Topic'],[5,'Attendee'],[7,'Time Allocated']] as const){sheet.getCell(r,c).value=title;header(sheet.getCell(r,c));}r++;
  for(const a of tracker.agenda){const row=sheet.getRow(r++);row.getCell(3).value=a.number;row.getCell(4).value=a.topic;row.getCell(5).value=a.attendee;row.getCell(7).value=a.time;styleRow(row,row.number,a.urgent);row.height=34;}
  r+=2;
  function projectHeader(){for(let i=0;i<FIELDS.length;i++){const field=FIELDS[i];if(!field)continue;const cell=sheet.getCell(r,i+2);cell.value=HEADERS[field];header(cell);}r++;}
  projectHeader();
  for(const p of tracker.projects.filter(p=>p.section==='projects')){
    const row=sheet.getRow(r++);
    for(let i=0;i<FIELDS.length;i++){const f=FIELDS[i];if(!f)continue;row.getCell(i+2).value=f==='overview'||f==='updates'?styledNotes(p[f],p.urgentLines[f]):p[f];}
    styleRow(row,row.number,p.urgent);row.height=46;
  }
  r+=2;sheet.getCell(r,3).value='MIDDLE EAST REGION';header(sheet.getCell(r,3));r++;
  for(const p of tracker.projects.filter(p=>p.section==='regional')){
    const row=sheet.getRow(r++);row.getCell(2).value=p.priority;row.getCell(3).value=p.client;row.getCell(4).value=p.country;row.getCell(5).value=p.projectNo;row.getCell(6).value=p.well;row.getCell(8).value=p.lead;
    row.getCell(7).value=styledNotes(p.overview,p.urgentLines.overview);styleRow(row,row.number,p.urgent);row.height=40;
    if(p.updates){const rr=sheet.getRow(r++);rr.getCell(7).value='Update';const ur=sheet.getRow(r++);ur.getCell(7).value=styledNotes(p.updates,p.urgentLines.updates);ur.alignment={wrapText:true};ur.height=43;}
  }
  r+=2;sheet.getCell(r,3).value='MISCELLANEOUS';header(sheet.getCell(r,3));r++;
  sheet.getCell(r,3).value='No.';sheet.getCell(r,4).value='Description';header(sheet.getCell(r,3));header(sheet.getCell(r,4));r++;
  tracker.misc.forEach((m,i)=>{const row=sheet.getRow(r++);row.getCell(3).value=String(i+1);row.getCell(4).value=m.description;row.getCell(7).value=styledNotes(m.notes,m.urgentLines);styleRow(row,row.number,m.urgent);row.height=44;});
}
export async function exportWorkbook(sheets:Tracker[]):Promise<Blob> {
  const Excel=await getExcel();const book=new Excel.Workbook();book.creator='Tracker Viewer';
  sheets.forEach((tracker,i)=>writeWeekly(book,tracker,i));
  const meta=book.addWorksheet('_TrackerViewer');meta.getCell('A1').value='Tracker Viewer metadata v2';
  const data=JSON.stringify({version:2,sheets});
  for(let i=0;i<data.length;i+=30000)meta.getCell(Math.floor(i/30000)+2,1).value=data.slice(i,i+30000);
  meta.state='veryHidden';
  const buffer=await book.xlsx.writeBuffer();
  return new Blob([buffer as unknown as BlobPart],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
}


/**
 * XLSX model codec. Parsing and exporting are asynchronous because the large
 * ExcelJS bundle is loaded only when workbook operations need it.
 */
export class WorkbookCodec {
  read(file: File): Promise<Tracker[]> { return importWorkbook(file); }
  write(sheets: Tracker[]): Promise<Blob> { return exportWorkbook(sheets); }
}
