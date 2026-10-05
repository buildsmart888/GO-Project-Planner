const fs = require("node:fs");
const vm = require("node:vm");
const assert = require("node:assert/strict");

const sandbox = {
  console,
  Date,
  setTimeout,
  clearTimeout,
  localStorage: { getItem: () => null, setItem: () => {} },
  window: { addEventListener: () => {}, CSS: { escape: (v) => v } }
};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync("app.js", "utf8"), sandbox);
const api = sandbox.window.__GO_PLANNER_TEST__;
assert.equal(api.isISODate("2026-02-30"),false,"Reject rolled-over calendar dates");
assert.equal(api.isISODate("2028-02-29"),true,"Accept leap-day dates");

const a4=api.printPageMetrics("A4"),a3=api.printPageMetrics("A3");
assert.ok(a3.widthPx>a4.widthPx&&a3.heightPx>a4.heightPx,"A3 printable area exceeds A4");
let layout=api.computePrintLayout({size:"A4",requestedMode:"page",contentWidthPx:1000,contentHeightPx:600,minScale:.58});
assert.equal(layout.mode,"page","Readable one-page reports stay in Fit Page");
assert.equal(layout.fallback,false);
layout=api.computePrintLayout({size:"A4",requestedMode:"page",contentWidthPx:2500,contentHeightPx:9000,minScale:.58});
assert.equal(layout.mode,"width","Unreadable Fit Page falls back to Fit Width");
assert.equal(layout.fallback,true);
layout=api.computePrintLayout({size:"A3",requestedMode:"width",contentWidthPx:5000,contentHeightPx:15000,minScale:.58});
assert.equal(layout.mode,"width","Explicit Fit Width is preserved");
assert.ok(layout.scale>0&&layout.scale<=1);

const printZoomShort=api.resolvePrintZoom(90,"A4",520);
const printZoomLong=api.resolvePrintZoom(365,"A4",520);
assert.ok(printZoomShort.px>printZoomLong.px,"Long timelines use denser print resolution");
assert.ok(printZoomLong.px>=2.5&&printZoomLong.px<=14,"Print timeline density remains bounded");
console.log("Print layout policy tests passed: A4/A3 sizing, readability fallback and timeline density.");

const task = (id, duration, predecessor = "") => ({ id, name: id, duration, predecessor });
const row = (schedule, id) => schedule.byId.get(id);

assert.deepEqual(JSON.parse(JSON.stringify(api.parsePredecessors("T100FS+2,T110SS,T120FF-1,T130SF+3,T140"))), [
  { id: "T100", type: "FS", lag: 2, invalid: false, raw: "T100FS+2" },
  { id: "T110", type: "SS", lag: 0, invalid: false, raw: "T110SS" },
  { id: "T120", type: "FF", lag: -1, invalid: false, raw: "T120FF-1" },
  { id: "T130", type: "SF", lag: 3, invalid: false, raw: "T130SF+3" },
  { id: "T140", type: "FS", lag: 0, invalid: false, raw: "T140" }
]);

let s = api.build([task("A", 3), task("B", 2, "AFS+2")]);
assert.equal(row(s, "B").es, 5, "FS + lag");
s = api.build([task("A", 5), task("B", 3, "ASS+2")]);
assert.equal(row(s, "B").es, 2, "SS + lag");
s = api.build([task("A", 5), task("B", 3, "AFF-1")]);
assert.equal(row(s, "B").ef, 3, "FF + lead");
s = api.build([task("A", 5), task("B", 2, "ASF+3")]);
assert.equal(row(s, "B").ef, 3, "SF + lag");
s = api.build([task("A", 3), task("B", 7), task("C", 2, "AFS,BSS+4")]);
assert.equal(row(s, "C").es, 4, "multiple predecessors use controlling constraint");
s = api.build([task("A", 3), task("B", 2, "A")]);
assert.equal(row(s, "B").es, 3, "legacy predecessor defaults to FS");
s = api.build([task("A", 2, "A")]);
assert.ok(s.issues.some((i) => /cannot depend on itself/.test(i.message)), "self reference detected");
s = api.build([task("A", 2, "MISSINGFS")]);
assert.ok(s.issues.some((i) => /missing predecessor/.test(i.message)), "missing reference detected");
s = api.build([task("A", 2, "B"), task("B", 2, "A")]);
assert.ok(s.issues.some((i) => /Circular/.test(i.message)), "cycle detected");
s = api.build([task("A", 2, "bad token !")]);
assert.ok(s.issues.some((i) => /invalid dependency/.test(i.message)), "invalid format detected");
const dated = task("D", 99);
dated.plannedStart = "2026-01-05";
dated.plannedFinish = "2026-01-08";
s = api.build([dated]);
assert.equal(row(s, "D").es, 4, "planned start is selectable");
assert.equal(row(s, "D").duration, 4, "planned finish derives inclusive duration");

console.log("Scheduler tests passed: FS, SS, FF, SF, lag/lead, multiple, legacy, dates and validation.");

const observed={...task("LOG",45),cost:1000,progress:90,actualCost:900,manpower:3,actualHistory:[{date:"2026-01-07",progress:20,cost:100},{date:"2026-01-14",progress:45,cost:280},{date:"2026-02-04",progress:80,cost:650}]};
let report=api.inspect([observed,{...task("SUMMARY",45),summary:true,cost:1000,manpower:30}],{dataDate:"2026-02-10"});
assert.equal(report.progress.actual[5],0,"Do not fabricate actual before first observation");
assert.equal(report.progress.actual[6],20);
assert.equal(report.progress.actual[12],20,"Hold known cumulative observation");
assert.equal(report.progress.actual[13],45);
assert.equal(report.metrics.totalPlanned,1000,"Exclude summary double count");
assert.equal(report.metrics.earnedValue,800,"Metrics use dated actual history");
assert.equal(report.metrics.actualCost,650);
assert.equal(report.monthly.reduce((sum,m)=>sum+m.actual,0),80,"Weekly-to-monthly increments reconcile");
assert.equal(report.monthly.reduce((sum,m)=>sum+m.cash,0),650,"Cash periods reconcile to cumulative cash");
assert.equal(report.resource.days[0].total,3,"Summary manpower excluded");
report=api.inspect([observed],{dataDate:"2026-01-10"});
assert.equal(report.progress.actual.at(-1),20,"Future records cannot leak through Data Date");
report=api.inspect([{...task("LEGACY",3),cost:100,progress:50,actualCost:25}],{dataDate:"2026-01-03"});
assert.equal(report.progress.actual[1],0,"Legacy snapshot does not invent past actual");
assert.equal(report.progress.actual[2],50);
report=api.inspect([{...task("ZERO",1),manpower:0}],{dataDate:"2026-01-01"});
assert.equal(report.resource.days[0].total,0,"Explicit zero manpower is respected");
console.log("Actual history, snapshot compatibility, monthly reconciliation and summary/resource integrity tests passed.");

// Mock XML DOM tests the importer mapping, not a replacement XML parser.
const element=(name,value)=>typeof value==="object"?{localName:name,children:Object.entries(value).flatMap(([k,v])=>Array.isArray(v)?v.map(x=>element(k,x)):[element(k,v)])}:{localName:name,textContent:String(value),children:[]};
const fixture=element("Project",{StartDate:"2026-01-01T08:00:00",StatusDate:"2026-01-14T17:00:00",MinutesPerDay:480,Tasks:{Task:[{UID:0,ID:0},{UID:101,ID:1,Name:"Foundation",Start:"2026-01-01T08:00:00",Finish:"2026-01-03T17:00:00",Duration:"PT24H0M0S",WBS:"1.1",Baseline:{Number:0,Start:"2025-12-30T08:00:00",Finish:"2026-01-01T17:00:00",Cost:100}},{UID:102,ID:2,Name:"Handover",Duration:"PT0H0M0S",Milestone:1,PredecessorLink:[{PredecessorUID:101,Type:1,LinkLag:9600},{PredecessorUID:999,Type:3,LinkLag:0}]}]}});
sandbox.DOMParser=class{parseFromString(){return {documentElement:fixture,querySelector:()=>null};}};
sandbox.FileReader=class{readAsText(file){this.result=file.content;this.onload();}};
api.importXml({name:"fixture.xml",content:"fixture"}).then(result=>{
  assert.equal(result.candidate.tasks.length,2);
  assert.equal(result.candidate.tasks[0].id,"MSP1","MSP UID maps through Task ID");
  assert.equal(result.candidate.tasks[0].baselineStart,"2025-12-30","Read direct Baseline element");
  assert.equal(result.candidate.tasks[1].duration,0,"Zero duration remains milestone");
  assert.equal(result.candidate.tasks[1].predecessor,"MSP1FS+2","Tenths of minute converted to project workdays");
  assert.ok(result.warnings.some(w=>w.includes("999")),"Missing links are warned, not silently lost");
  console.log("MS Project XML mapping/preview tests passed.");
}).catch(error=>{console.error(error);process.exitCode=1;});

const iso=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
s=api.build([task('A',2),task('B',1,'AFS')],'2026-01-02',{calendar:'work5'});
assert.equal(iso(row(s,'A').endDate),'2026-01-05');
assert.equal(iso(row(s,'B').startDate),'2026-01-06');
s=api.build([task('A',2)],'2026-01-02',{calendar:'work5',holidays:['2026-01-05']});
assert.equal(iso(row(s,'A').endDate),'2026-01-06');
s=api.build([task('A',2)],'2026-01-03',{calendar:'work6'});
assert.equal(iso(row(s,'A').endDate),'2026-01-05');
for(const relation of ['FS','SS','FF','SF']){
 s=api.build([task('A',5),task('B',3,`A${relation}+2`)],'2026-01-05',{calendar:'work5'});
 const a=row(s,'A'),b=row(s,'B');
 assert.ok(Number.isFinite(b.slack));
 if(relation==='FS')assert.equal(iso(b.startDate),'2026-01-14');
 if(relation==='SS')assert.equal(iso(b.startDate),'2026-01-07');
 if(relation==='FF')assert.equal(iso(b.endDate),'2026-01-13');
 if(relation==='SF')assert.equal(iso(b.endDate),'2026-01-07');
}
s=api.build([task('A',2),task('M',0,'AFS'),task('B',1,'MFS')],'2026-01-05',{calendar:'work5'});
assert.equal(row(s,'M').duration,0);assert.equal(row(s,'M').es,row(s,'B').es);
s=api.build([{...task('A',10),actualStart:'2026-01-05',remainingDuration:3,progress:40},task('B',2,'AFS')],'2026-01-05',{calendar:'work5',forecast:true,dataDate:'2026-01-09'});
assert.equal(iso(row(s,'A').endDate),'2026-01-13');assert.equal(iso(row(s,'B').startDate),'2026-01-14');
s=api.build([{...task('A',10),actualStart:'2026-01-05',actualFinish:'2026-01-08',progress:100}],'2026-01-05',{forecast:true,dataDate:'2026-01-12'});
assert.equal(iso(row(s,'A').endDate),'2026-01-08');
console.log('Working calendars, holidays, milestones and forecast tests passed.');
