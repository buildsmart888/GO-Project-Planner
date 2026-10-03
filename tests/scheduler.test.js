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

const iso=d=>d.toISOString().slice(0,10);
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
