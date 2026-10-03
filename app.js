(() => {
  "use strict";

  const STORAGE_KEY = "go-project-planner.v1";
  const STATUS_ORDER = ["backlog", "in-progress", "review", "done"];
  const STATUS_META = {
    backlog: { label: "Backlog", color: "var(--ink-400)" },
    "in-progress": { label: "In progress", color: "var(--blue)" },
    review: { label: "Review", color: "var(--purple)" },
    done: { label: "Done", color: "var(--green)" }
  };
  const ZOOM = {
    month: { px: 7, tick: 14 },
    week: { px: 18, tick: 7 },
    day: { px: 38, tick: 1 }
  };

  let state = loadState();
  let currentSchedule = null;
  let saveTimer = null;
  let draggedTaskId = null;
  let networkView = { scale: 1, x: 20, y: 20 };
  let networkDrag = null;
  let historyPast = [], historyFuture = [], historySnapshot = null;
  let pendingXmlImport = null;

  function init() {
    initPilot();
    initControl09();
    wireEvents();
    renderAll();
    setView(state.ui.activeView || "dashboard", false);
    document.body.dataset.ready = "true";
  }

  function wireEvents() {
    document.addEventListener("click", (event) => {
      const nav = event.target.closest("[data-view]");
      if (nav) {
        setView(nav.dataset.view);
        return;
      }

      const targetView = event.target.closest("[data-view-target]");
      if (targetView) {
        setView(targetView.dataset.viewTarget);
        return;
      }

      if (event.target.closest("#top-add-task, #sidebar-add-task, #schedule-add-task, #kanban-add-task")) {
        openTaskModal();
        return;
      }

      const wbsToggle = event.target.closest("[data-wbs-toggle]");
      if (wbsToggle) {
        event.stopPropagation();
        const id = wbsToggle.dataset.wbsToggle.toUpperCase();
        const collapsed = new Set(state.ui.collapsedWbs || []);
        collapsed.has(id) ? collapsed.delete(id) : collapsed.add(id);
        state.ui.collapsedWbs = [...collapsed];
        saveState(); renderSchedule(currentSchedule || buildSchedule()); return;
      }
      const editTarget = event.target.closest("[data-edit-task]");
      if (editTarget) {
        openTaskModal(editTarget.dataset.editTask);
        return;
      }

      const zoomButton = event.target.closest("[data-zoom]");
      if (zoomButton) {
        state.ui.zoom = zoomButton.dataset.zoom;
        saveState();
        renderSchedule(currentSchedule || buildSchedule());
        return;
      }
      if (event.target.closest("#gantt-table-toggle")) {
        state.ui.ganttTableVisible = !state.ui.ganttTableVisible;
        saveState(); renderSchedule(currentSchedule || buildSchedule()); return;
      }
      const criticalMode = event.target.closest("[data-gantt-critical]");
      if (criticalMode) {
        state.ui.ganttCriticalMode = criticalMode.dataset.ganttCritical;
        saveState(); renderSchedule(currentSchedule || buildSchedule()); return;
      }

      if (event.target.closest("#today-button")) {
        setView("schedule");
        requestAnimationFrame(scrollGanttToToday);
        return;
      }

      if (event.target.closest("#export-json-button, #settings-export-json")) {
        exportProjectJson();
        return;
      }

      if (event.target.closest("#schedule-export-csv, #settings-export-csv")) {
        exportTaskCsv();
        return;
      }

      if (event.target.closest("#settings-import-json")) {
        document.getElementById("import-json-input").click();
        return;
      }
      if (event.target.closest("#settings-import-msp-xml")) {
        document.getElementById("import-msp-xml-input").click();
        return;
      }

      if (event.target.closest("#settings-reset-demo")) {
        resetDemo();
        return;
      }

      if (event.target.closest("#set-baseline-button")) {
        setBaseline();
        return;
      }

      if (event.target.closest("#print-cost-view")) {
        printView("costs");
        return;
      }

      if (event.target.closest("#print-current-view")) {
        printView(state.ui.activeView || "dashboard");
        return;
      }
      const printTarget = event.target.closest("[data-print-view]");
      if (printTarget) {
        printView(printTarget.dataset.printView);
        return;
      }

      if (event.target.closest("#critical-only-button")) {
        state.ui.criticalOnly = true;
        saveState();
        renderCriticalPath(currentSchedule || buildSchedule(), true);
        return;
      }

      if (event.target.closest("#critical-all-button")) {
        state.ui.criticalOnly = false;
        saveState();
        renderCriticalPath(currentSchedule || buildSchedule(), true);
        return;
      }

      if (event.target.closest("#critical-zoom-in")) {
        changeNetworkZoom(1.2);
        return;
      }

      if (event.target.closest("#critical-zoom-out")) {
        changeNetworkZoom(1 / 1.2);
        return;
      }

      if (event.target.closest("#critical-fit")) {
        renderCriticalPath(currentSchedule || buildSchedule(), true);
        return;
      }

      if (event.target.closest("#close-task-modal, #cancel-task-button")) {
        closeTaskModal();
        return;
      }

      if (event.target.id === "modal-backdrop") {
        closeTaskModal();
        return;
      }

      if (event.target.closest("#delete-task-button")) {
        deleteTaskFromModal();
      }
    });

    document.addEventListener("input", (event) => {
      if (event.target.id === "task-search") {
        state.ui.search = event.target.value;
        renderSchedule(currentSchedule || buildSchedule());
      }
      if (event.target.id === "gantt-table-width") {
        state.ui.ganttTableWidth = Number(event.target.value);
        document.querySelector("#gantt-chart .gantt-inner")?.style.setProperty("--label-width", `${state.ui.ganttTableWidth}px`);
      }

      if (event.target.matches("[data-progress-label-for]")) {
        const label = document.querySelector(`[data-progress-value="${cssEscape(event.target.dataset.progressLabelFor)}"]`);
        if (label) label.textContent = `${event.target.value}%`;
      }
    });

    document.addEventListener("change", (event) => {
      if (event.target.id === "kanban-owner-filter") {
        state.ui.ownerFilter = event.target.value;
        saveState();
        renderKanban(currentSchedule || buildSchedule());
        return;
      }


      if (event.target.id === "gantt-scurve-toggle") {
        state.ui.showGanttSCurve = event.target.checked;
        saveState();
        renderSchedule(currentSchedule || buildSchedule());
        return;
      }

      if (event.target.id === "gantt-scurve-period") {
        state.ui.curvePeriod = event.target.value === "month" ? "month" : "week";
        saveState();
        renderSchedule(currentSchedule || buildSchedule());
        return;
      }
      if (event.target.id === "gantt-table-width") { saveState(); renderSchedule(currentSchedule || buildSchedule()); return; }
      if (event.target.matches("[data-gantt-column]")) {
        const selected = [...document.querySelectorAll("[data-gantt-column]:checked")].map((el) => el.dataset.ganttColumn);
        state.ui.ganttColumns = selected.length ? selected : ["name"];
        saveState(); renderSchedule(currentSchedule || buildSchedule()); return;
      }

      if (event.target.matches("[data-progress-label-for]")) {
        updateTaskProgress(event.target.dataset.progressLabelFor, Number(event.target.value));
      }
    });

    document.getElementById("task-form").addEventListener("submit", handleTaskSubmit);
    document.getElementById("project-settings-form").addEventListener("submit", handleProjectSettings);
    document.getElementById("import-json-input").addEventListener("change", importProjectJson);
    document.getElementById("import-msp-xml-input").addEventListener("change", importMicrosoftProjectXml);

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !document.getElementById("modal-backdrop").hidden) closeTaskModal();
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        saveState(true);
        showToast("Project saved to this browser.", "success");
      }
    });

    document.addEventListener("dragstart", (event) => {
      const card = event.target.closest(".kanban-card");
      if (!card) return;
      draggedTaskId = card.dataset.taskId;
      card.classList.add("dragging");
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", draggedTaskId);
    });

    document.addEventListener("dragend", (event) => {
      const card = event.target.closest(".kanban-card");
      if (card) card.classList.remove("dragging");
      document.querySelectorAll(".kanban-column.drag-over").forEach((column) => column.classList.remove("drag-over"));
      draggedTaskId = null;
    });

    document.addEventListener("dragover", (event) => {
      const column = event.target.closest(".kanban-column");
      if (!column) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      column.classList.add("drag-over");
    });

    document.addEventListener("dragleave", (event) => {
      const column = event.target.closest(".kanban-column");
      if (column && !column.contains(event.relatedTarget)) column.classList.remove("drag-over");
    });

    document.addEventListener("drop", (event) => {
      const column = event.target.closest(".kanban-column");
      if (!column) return;
      event.preventDefault();
      column.classList.remove("drag-over");
      const taskId = event.dataTransfer.getData("text/plain") || draggedTaskId;
      if (taskId) moveTaskToStatus(taskId, column.dataset.status);
    });

    const network = document.getElementById("critical-network");
    network.addEventListener("wheel", (event) => {
      event.preventDefault();
      changeNetworkZoom(event.deltaY < 0 ? 1.12 : 1 / 1.12);
    }, { passive: false });
    network.addEventListener("pointerdown", (event) => {
      if (event.target.closest("[data-edit-task]")) return;
      network.setPointerCapture(event.pointerId);
      networkDrag = { x: event.clientX, y: event.clientY, ox: networkView.x, oy: networkView.y };
      network.classList.add("dragging");
    });
    network.addEventListener("pointermove", (event) => {
      if (!networkDrag) return;
      networkView.x = networkDrag.ox + event.clientX - networkDrag.x;
      networkView.y = networkDrag.oy + event.clientY - networkDrag.y;
      applyNetworkTransform();
    });
    network.addEventListener("pointerup", () => { networkDrag = null; network.classList.remove("dragging"); });
    network.addEventListener("pointercancel", () => { networkDrag = null; network.classList.remove("dragging"); });
  }

  function makeDemoState() {
    const today = startOfDay(new Date());
    const projectStart = addDays(today, -18);
    return {
      version: 1,
      project: {
        name: "Factory Expansion — Phase 1",
        startDate: toISO(projectStart),
        budget: 5500000,
        currency: "THB",
        calendar: "calendar",
        note: "Demonstration project using calendar-day durations and FS, SS, FF and SF predecessor logic.",
        dataDate: toISO(today),
        resourceCapacity: 70
      },
      tasks: [
        { id: "T100", name: "Project charter & scope", owner: "PMO", duration: 3, predecessor: "", cost: 45000, actualCost: 43000, progress: 100, status: "done", notes: "Approve scope, objectives and governance." },
        { id: "T110", name: "Site survey", owner: "Civil", duration: 4, predecessor: "T100", cost: 85000, actualCost: 82000, progress: 100, status: "done", notes: "Topographic and utility survey." },
        { id: "T120", name: "Concept design", owner: "Design", duration: 6, predecessor: "T100", cost: 120000, actualCost: 115000, progress: 100, status: "done", notes: "Freeze primary layout and design basis." },
        { id: "T130", name: "Detailed design", owner: "Design", duration: 8, predecessor: "T120", cost: 210000, actualCost: 195000, progress: 90, status: "review", notes: "Issue coordinated construction package for review." },
        { id: "T140", name: "Authority approval", owner: "Permits", duration: 10, predecessor: "T130", cost: 35000, actualCost: 12000, progress: 20, status: "in-progress", notes: "Submit and close authority comments." },
        { id: "T150", name: "Long-lead procurement", owner: "Procurement", duration: 14, predecessor: "T130SS+1", cost: 850000, actualCost: 80000, progress: 15, status: "in-progress", notes: "Structural steel, switchgear and major equipment." },
        { id: "T160", name: "Mobilization", owner: "Construction", duration: 4, predecessor: "T110FS,T140SS+6", cost: 140000, actualCost: 0, progress: 0, status: "backlog", notes: "Temporary facilities, access and safety controls." },
        { id: "T170", name: "Foundation works", owner: "Civil", duration: 12, predecessor: "T160", cost: 1100000, actualCost: 0, progress: 0, status: "backlog", notes: "Piles, pile caps, grade beams and slab preparation." },
        { id: "T180", name: "Structural steel erection", owner: "Structure", duration: 10, predecessor: "T170,T150", cost: 1450000, actualCost: 0, progress: 0, status: "backlog", notes: "Frame erection, alignment and bolt torque inspection." },
        { id: "T190", name: "MEP installation", owner: "MEP", duration: 9, predecessor: "T180", cost: 850000, actualCost: 0, progress: 0, status: "backlog", notes: "Electrical, plumbing, ventilation and fire protection." },
        { id: "T200", name: "Testing & commissioning", owner: "QA/QC", duration: 5, predecessor: "T190", cost: 180000, actualCost: 0, progress: 0, status: "backlog", notes: "Functional tests, punch list and commissioning records." },
        { id: "T210", name: "Handover", owner: "PMO", duration: 2, predecessor: "T200", cost: 40000, actualCost: 0, progress: 0, status: "backlog", notes: "As-built documents, training and acceptance." }
      ],
      ui: {
        activeView: "dashboard",
        zoom: "week",
        search: "",
        ownerFilter: "all",
        curvePeriod: "month",
        curveMatrixVersion: 1
      }
    };
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return normalizeState(makeDemoState());
      return normalizeState(JSON.parse(raw));
    } catch (error) {
      console.warn("Could not load saved project", error);
      return normalizeState(makeDemoState());
    }
  }

  function normalizeState(input) {
    const demo = makeDemoState();
    if (!input || typeof input !== "object") return demo;
    const project = input.project && typeof input.project === "object" ? input.project : {};
    const tasks = Array.isArray(input.tasks) ? input.tasks : [];
    const seen = new Set();
    const normalizedTasks = tasks.map((task, index) => {
      let id = String(task.id || `T${(index + 1) * 10}`).trim().toUpperCase().replace(/[^A-Z0-9_-]/g, "");
      if (!id) id = `T${(index + 1) * 10}`;
      let uniqueId = id;
      let suffix = 2;
      while (seen.has(uniqueId)) uniqueId = `${id}_${suffix++}`;
      seen.add(uniqueId);
      return {
        id: uniqueId,
        name: String(task.name || `Task ${index + 1}`),
        owner: String(task.owner || "Unassigned"),
        wbs: String(task.wbs || "General"),
        outlineLevel: clampNumber(task.outlineLevel, 0, 20, 1),
        summary: Boolean(task.summary),
        sourceDuration: clampNumber(task.sourceDuration, 0, 999999, 0),
        resourceTeam: String(task.resourceTeam || task.owner || "General crew"),
        manpower: clampNumber(task.manpower, 0, 9999, defaultManpower(task.owner)),
        duration: clampNumber(task.duration, 0, 999, 1),
        milestone: Boolean(task.milestone) || Number(task.duration) === 0,
        remainingDuration: task.remainingDuration === "" || task.remainingDuration == null ? null : clampNumber(task.remainingDuration, 0, 999, 0),
        predecessor: String(task.predecessor || ""),
        plannedStart: isISODate(task.plannedStart) ? task.plannedStart : "",
        plannedFinish: isISODate(task.plannedFinish) ? task.plannedFinish : "",
        actualStart: isISODate(task.actualStart) ? task.actualStart : "",
        actualFinish: isISODate(task.actualFinish) ? task.actualFinish : "",
        baselineStart: isISODate(task.baselineStart) ? task.baselineStart : "",
        baselineFinish: isISODate(task.baselineFinish) ? task.baselineFinish : "",
        baselineCost: clampNumber(task.baselineCost, 0, Number.MAX_SAFE_INTEGER, 0),
        cost: clampNumber(task.cost, 0, Number.MAX_SAFE_INTEGER, 0),
        actualCost: clampNumber(task.actualCost, 0, Number.MAX_SAFE_INTEGER, 0),
        actualHistory: normalizeActualHistory(task.actualHistory),
        constraint: String(task.constraint || ""),
        constraintOwner: String(task.constraintOwner || task.owner || ""),
        constraintDue: isISODate(task.constraintDue) ? task.constraintDue : "",
        ready: task.ready !== false,
        progress: clampNumber(task.progress, 0, 100, 0),
        status: STATUS_ORDER.includes(task.status) ? task.status : "backlog",
        notes: String(task.notes || "")
      };
    });

    return {
      version: 1,
      project: {
        name: String(project.name || demo.project.name),
        startDate: isISODate(project.startDate) ? project.startDate : demo.project.startDate,
        budget: clampNumber(project.budget, 0, Number.MAX_SAFE_INTEGER, demo.project.budget),
        currency: ["THB", "USD", "EUR", "GBP", "SGD"].includes(project.currency) ? project.currency : "THB",
        calendar: ["calendar","work5","work6"].includes(project.calendar) ? project.calendar : "calendar",
        holidays: Array.isArray(project.holidays) ? project.holidays.filter(isISODate) : [],
        forecast: Boolean(project.forecast),
        dataDate: isISODate(project.dataDate) ? project.dataDate : toISO(startOfDay(new Date())),
        resourceCapacity: clampNumber(project.resourceCapacity, 1, 999999, 70),
        note: String(project.note || "")
      },
      tasks: normalizedTasks,
      ui: {
        activeView: ["dashboard", "schedule", "critical", "kanban", "costs", "resources", "lookahead", "settings"].includes(input.ui?.activeView) ? input.ui.activeView : "dashboard",
        zoom: ["month", "week", "day"].includes(input.ui?.zoom) ? input.ui.zoom : "week",
        search: String(input.ui?.search || ""),
        ownerFilter: String(input.ui?.ownerFilter || "all"),
        criticalOnly: Boolean(input.ui?.criticalOnly),
        showGanttSCurve: Boolean(input.ui?.showGanttSCurve),
        curvePeriod: input.ui?.curveMatrixVersion ? (input.ui?.curvePeriod === "week" ? "week" : "month") : "month",
        curveMatrixVersion: 1,
        ganttTableVisible: input.ui?.ganttTableVisible !== false,
        ganttTableWidth: clampNumber(input.ui?.ganttTableWidth, 320, 920, 760),
        ganttColumns: Array.isArray(input.ui?.ganttColumns) && input.ui.ganttColumns.length ? input.ui.ganttColumns : ["id","wbs","name","start","finish","days","tf","plan","actual","status"],
        ganttCriticalMode: ["all","highlight","only"].includes(input.ui?.ganttCriticalMode) ? input.ui.ganttCriticalMode : "all",
        collapsedWbs: Array.isArray(input.ui?.collapsedWbs) ? input.ui.collapsedWbs.map(String) : []
      }
    };
  }

  function saveState(immediate = false) {
    const snapshot = JSON.stringify({project:state.project,tasks:state.tasks});
    if (historySnapshot && snapshot !== historySnapshot) { historyPast.push(historySnapshot); historyPast = historyPast.slice(-40); historyFuture = []; }
    historySnapshot = snapshot;
    const indicator = document.getElementById("save-status");
    if (indicator) {
      indicator.classList.add("saving");
      indicator.innerHTML = '<span class="save-dot"></span> Saving';
    }
    clearTimeout(saveTimer);
    const execute = () => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
        persistPilotProject();
        if (indicator) {
          indicator.classList.remove("saving");
          indicator.innerHTML = '<span class="save-dot"></span> Saved locally';
        }
      } catch (error) {
        console.error(error);
        if (indicator) {
          indicator.classList.remove("saving");
          indicator.textContent = "Save failed";
        }
      }
    };
    if (immediate) execute();
    else saveTimer = setTimeout(execute, 220);
  }

  function renderAll() {
    currentSchedule = buildSchedule();
    document.getElementById("top-project-name").textContent = state.project.name;
    document.title = `${state.project.name} — GO Project Planner`;
    renderProjectHealth(currentSchedule);
    renderDashboard(currentSchedule);
    renderSchedule(currentSchedule);
    renderCriticalPath(currentSchedule, true);
    renderKanban(currentSchedule);
    renderCosts(currentSchedule);
    renderResources(currentSchedule);
    renderLookahead(currentSchedule);
    renderSettings();
  }

  function setView(view, persist = true) {
    const target = document.getElementById(`view-${view}`);
    if (!target) return;
    document.querySelectorAll(".view").forEach((element) => element.classList.toggle("active", element === target));
    document.querySelectorAll(".nav-item").forEach((element) => element.classList.toggle("active", element.dataset.view === view));
    state.ui.activeView = view;
    if (persist) saveState();
    window.scrollTo({ top: 0, behavior: "auto" });
    if (view === "critical") requestAnimationFrame(() => renderCriticalPath(currentSchedule || buildSchedule(), true));
  }

  function buildSchedule() {
    if (state.project.calendar !== "calendar" || state.project.holidays?.length || state.project.forecast || state.tasks.some(t=>t.milestone || t.duration===0)) return buildWorkingSchedule();
    const tasks = state.tasks;
    const projectStart = fromISO(state.project.startDate);
    const byId = new Map(tasks.map((task, index) => [task.id.toUpperCase(), { task, index }]));
    const issues = [];
    const predecessorMap = new Map();
    const successorMap = new Map(tasks.map((task) => [task.id.toUpperCase(), []]));
    const indegree = new Map(tasks.map((task) => [task.id.toUpperCase(), 0]));

    tasks.forEach((task) => {
      const taskId = task.id.toUpperCase();
      const parsed = parsePredecessors(task.predecessor);
      const valid = [];
      parsed.forEach((pred) => {
        if (pred.invalid) {
          issues.push({ type: "error", taskId, message: `${taskId} has invalid dependency “${pred.raw}”. Use ID + FS/FF/SS/SF + optional lag, e.g. T100FS+2.` });
          return;
        }
        if (pred.id === taskId) {
          issues.push({ type: "error", taskId, message: `${taskId} cannot depend on itself.` });
          return;
        }
        if (!byId.has(pred.id)) {
          issues.push({ type: "warning", taskId, message: `${taskId} references missing predecessor ${pred.id}.` });
          return;
        }
        valid.push(pred);
        successorMap.get(pred.id).push({ id: taskId, lag: pred.lag, type: pred.type });
      });
      predecessorMap.set(taskId, valid);
      indegree.set(taskId, valid.length);
    });

    const queue = tasks
      .filter((task) => indegree.get(task.id.toUpperCase()) === 0)
      .sort((a, b) => byId.get(a.id.toUpperCase()).index - byId.get(b.id.toUpperCase()).index)
      .map((task) => task.id.toUpperCase());
    const topo = [];

    while (queue.length) {
      const id = queue.shift();
      topo.push(id);
      successorMap.get(id).forEach((successor) => {
        const next = indegree.get(successor.id) - 1;
        indegree.set(successor.id, next);
        if (next === 0) {
          queue.push(successor.id);
          queue.sort((a, b) => byId.get(a).index - byId.get(b).index);
        }
      });
    }

    const cycleIds = tasks.map((task) => task.id.toUpperCase()).filter((id) => !topo.includes(id));
    if (cycleIds.length) {
      issues.push({ type: "error", taskId: cycleIds.join(", "), message: `Circular predecessor logic detected: ${cycleIds.join(", ")}.` });
    }

    const timing = new Map();
    topo.forEach((id) => {
      const { task } = byId.get(id);
      const duration = effectiveTaskDuration(task, projectStart);
      let es = 0;
      predecessorMap.get(id).forEach((pred) => {
        const predTiming = timing.get(pred.id);
        if (!predTiming) return;
        let bound = 0;
        if (pred.type === "FS") bound = predTiming.ef + 1 + pred.lag;
        if (pred.type === "SS") bound = predTiming.es + pred.lag;
        if (pred.type === "FF") bound = predTiming.ef + pred.lag - duration + 1;
        if (pred.type === "SF") bound = predTiming.es + pred.lag - duration + 1;
        es = Math.max(es, bound);
      });
      if (task.plannedStart) es = Math.max(es, diffDays(projectStart, fromISO(task.plannedStart)));
      else if (task.plannedFinish) es = Math.max(es, diffDays(projectStart, fromISO(task.plannedFinish)) - duration + 1);
      es = Math.max(0, es);
      const ef = es + duration - 1;
      if (task.plannedFinish && ef !== diffDays(projectStart, fromISO(task.plannedFinish))) {
        issues.push({ type: "warning", taskId: id, message: `${id} planned finish is overridden by predecessor or start constraints.` });
      }
      timing.set(id, { es, ef, duration, cycle: false });
    });

    cycleIds.forEach((id) => {
      const { task } = byId.get(id);
      const duration = effectiveTaskDuration(task, projectStart);
      timing.set(id, { es: 0, ef: duration - 1, duration, cycle: true, slack: null, critical: false });
    });

    const projectFinishIndex = Math.max(0, ...Array.from(timing.values()).map((item) => item.ef));
    [...topo].reverse().forEach((id) => {
      const item = timing.get(id);
      const successors = successorMap.get(id).filter((successor) => timing.has(successor.id) && !timing.get(successor.id).cycle);
      let lf = projectFinishIndex;
      if (successors.length) {
        lf = Math.min(...successors.map((successor) => {
          const next = timing.get(successor.id);
          if (successor.type === "FS") return next.ls - 1 - successor.lag;
          if (successor.type === "SS") return next.ls - successor.lag + item.duration - 1;
          if (successor.type === "FF") return next.lf - successor.lag;
          return next.lf - successor.lag + item.duration - 1;
        }));
      }
      const ls = lf - item.duration + 1;
      const slack = ls - item.es;
      Object.assign(item, { lf, ls, slack, critical: slack === 0 });
    });

    const rows = tasks.map((task) => {
      const schedule = timing.get(task.id.toUpperCase());
      return {
        task,
        ...schedule,
        startDate: addDays(projectStart, schedule.es),
        endDate: addDays(projectStart, schedule.ef),
        predecessors: predecessorMap.get(task.id.toUpperCase()) || []
      };
    });

    return {
      rows,
      byId: new Map(rows.map((row) => [row.task.id.toUpperCase(), row])),
      issues,
      projectStart,
      projectFinishIndex,
      projectFinishDate: addDays(projectStart, projectFinishIndex),
      todayIndex: diffDays(projectStart, fromISO(state.project.dataDate || toISO(startOfDay(new Date())))),
      topo,
      successorMap
    };
  }

  function buildWorkingSchedule() {
    const projectStart=fromISO(state.project.startDate), tasks=state.tasks, issues=[];
    const holidays=new Set(state.project.holidays||[]);
    const working=date=>!holidays.has(toISO(date)) && (state.project.calendar==="work5" ? date.getDay()>0 && date.getDay()<6 : state.project.calendar==="work6" ? date.getDay()!==0 : true);
    let origin=projectStart; while(!working(origin))origin=addDays(origin,1);
    const dates=[origin];
    const dateAt=index=>{ index=Math.round(index);if(index<0){let d=origin;for(let n=0;n>index;){d=addDays(d,-1);if(working(d))n--;}return d;}
      while(dates.length<=index){let d=addDays(dates.at(-1),1);while(!working(d))d=addDays(d,1);dates.push(d);}return dates[index];};
    const indexAt=date=>{let index=0;if(date<origin){while(dateAt(index)>date)index--;return index;}while(dateAt(index)<date)index++;return index;};
    const ids=new Map(tasks.map(t=>[t.id.toUpperCase(),t])), preds=new Map(), successorMap=new Map(tasks.map(t=>[t.id.toUpperCase(),[]])), degree=new Map();
    tasks.forEach(task=>{const id=task.id.toUpperCase(), links=[];parsePredecessors(task.predecessor).forEach(p=>{
      if(p.invalid||p.id===id||!ids.has(p.id)){issues.push({type:"error",taskId:id,message:p.invalid?`Invalid dependency ${p.raw}`:p.id===id?"Self dependency":`Missing predecessor ${p.id}`});return;}
      links.push(p);successorMap.get(p.id).push({id,type:p.type,lag:p.lag});});preds.set(id,links);degree.set(id,links.length);});
    const queue=tasks.filter(t=>!degree.get(t.id.toUpperCase())).map(t=>t.id.toUpperCase()),topo=[];
    while(queue.length){const id=queue.shift();topo.push(id);successorMap.get(id).forEach(s=>{degree.set(s.id,degree.get(s.id)-1);if(!degree.get(s.id))queue.push(s.id);});}
    const cycles=[...ids.keys()].filter(id=>!topo.includes(id));if(cycles.length)issues.push({type:"error",taskId:cycles.join(", "),message:`Circular predecessor logic detected: ${cycles.join(", ")}`});
    const timing=new Map(), dataIndex=indexAt(fromISO(state.project.dataDate));
    const normalDuration=task=>task.milestone?0:task.plannedStart&&task.plannedFinish?Math.max(1,indexAt(fromISO(task.plannedFinish))-indexAt(fromISO(task.plannedStart))+1):Math.max(1,task.duration);
    const span=d=>Math.max(0,d-1);
    const edge=(p,prev,d)=>p.type==="FS"?prev.finish+(prev.workDuration===0?0:1)+p.lag:p.type==="SS"?prev.start+p.lag:p.type==="FF"?prev.finish+p.lag-span(d):prev.start+p.lag-span(d);
    [...topo,...cycles].forEach(id=>{
      const task=ids.get(id);let d=normalDuration(task), start=0,finish, fixed=false;
      if(task.plannedStart)start=indexAt(fromISO(task.plannedStart));else if(task.plannedFinish)start=indexAt(fromISO(task.plannedFinish))-span(d);
      if(state.project.forecast && task.actualStart){
        start=indexAt(fromISO(task.actualStart));fixed=true;
        if(task.actualFinish){finish=indexAt(fromISO(task.actualFinish));d=Math.max(0,finish-start+1);if(task.milestone)d=0;}
        else{const remaining=task.remainingDuration??Math.ceil(d*(1-task.progress/100));finish=Math.max(start,dataIndex)+span(remaining);d=Math.max(1,finish-start+1);}
      } else {
        if(state.project.forecast){start=Math.max(start,dataIndex);if(task.remainingDuration!=null && !task.milestone)d=Math.max(1,task.remainingDuration);}
        preds.get(id).forEach(p=>{const prev=timing.get(p.id);if(prev)start=Math.max(start,edge(p,prev,d));});start=Math.max(0,start);finish=start+span(d);
      }
      if(fixed)preds.get(id).forEach(p=>{const prev=timing.get(p.id);if(prev && start<edge(p,prev,d))issues.push({type:"warning",taskId:id,message:"Actual dates conflict with predecessor logic; actual dates retained."});});
      timing.set(id,{start,finish,workDuration:d,fixed,cycle:cycles.includes(id)});
    });
    const finishIndex=Math.max(0,...[...timing.values()].map(t=>t.finish));
    [...topo].reverse().forEach(id=>{const t=timing.get(id);let latest=finishIndex-span(t.workDuration);
      successorMap.get(id).forEach(s=>{const n=timing.get(s.id);if(n.cycle)return;const bound=s.type==="FS"?n.latestStart-(t.workDuration===0?0:1)-s.lag-span(t.workDuration):s.type==="SS"?n.latestStart-s.lag:s.type==="FF"?n.latestStart+span(n.workDuration)-s.lag-span(t.workDuration):n.latestStart+span(n.workDuration)-s.lag;
        latest=Math.min(latest,bound);});
      t.latestStart=latest;t.slack=latest-t.start;t.critical=!t.fixed && t.slack<=0;
    });
    const rows=tasks.map(task=>{const t=timing.get(task.id.toUpperCase()), startDate=dateAt(t.start),endDate=dateAt(t.finish);
      const actualStart=state.project.forecast&&task.actualStart?fromISO(task.actualStart):startDate;
      const actualEnd=state.project.forecast&&task.actualFinish?fromISO(task.actualFinish):endDate;
      const es=diffDays(projectStart,actualStart),ef=diffDays(projectStart,actualEnd);
      return {task,es,ef,ls:t.latestStart==null?null:diffDays(projectStart,dateAt(t.latestStart)),lf:t.latestStart==null?null:diffDays(projectStart,dateAt(t.latestStart+span(t.workDuration))),duration:task.milestone?0:Math.max(1,ef-es+1),workDuration:t.workDuration,slack:t.cycle?null:t.slack,critical:t.critical||false,cycle:t.cycle,startDate:actualStart,endDate:actualEnd,predecessors:preds.get(task.id.toUpperCase())};});
    const projectFinishIndex=Math.max(0,...rows.map(r=>r.ef));
    return {rows,byId:new Map(rows.map(r=>[r.task.id.toUpperCase(),r])),issues,projectStart,projectFinishIndex,projectFinishDate:addDays(projectStart,projectFinishIndex),todayIndex:diffDays(projectStart,fromISO(state.project.dataDate)),topo,successorMap};
  }

  function effectiveTaskDuration(task, projectStart) {
    if (task.plannedStart && task.plannedFinish) {
      return Math.max(1, diffDays(fromISO(task.plannedStart), fromISO(task.plannedFinish)) + 1);
    }
    return Math.max(1, Math.round(Number(task.duration) || 1));
  }

  function parsePredecessors(value) {
    if (!value || !String(value).trim()) return [];
    return String(value)
      .split(",")
      .map((token) => token.trim().toUpperCase())
      .filter(Boolean)
      .map((token) => {
        const compact = token.replace(/\s+/g, "");
        const match = compact.match(/^([A-Z0-9_-]+?)(FS|FF|SS|SF)?(?:([+-])(\d+))?$/);
        if (!match) return { id: compact, type: "FS", lag: 0, invalid: true, raw: token };
        const lag = match[3] ? Number(match[4]) * (match[3] === "-" ? -1 : 1) : 0;
        return { id: match[1], type: match[2] || "FS", lag, invalid: false, raw: token };
      });
  }

  function dependencyLabel(pred) {
    return `${pred.id}${pred.type}${pred.lag > 0 ? `+${pred.lag}` : pred.lag < 0 ? pred.lag : ""}`;
  }

  function renderProjectHealth(schedule) {
    const metrics = calculatePerformance(schedule);
    const overdue = schedule.rows.filter((row) => row.endDate < startOfDay(new Date()) && row.task.progress < 100).length;
    let label = "On track";
    let copy = "Schedule and cost are within plan.";
    let score = 86;
    let color = "var(--accent)";
    if ((metrics.spi && metrics.spi < 0.85) || (metrics.cpi && metrics.cpi < 0.85) || overdue >= 3) {
      label = "At risk";
      copy = "Review overdue work and cost efficiency.";
      score = 43;
      color = "var(--red)";
    } else if ((metrics.spi && metrics.spi < 0.97) || (metrics.cpi && metrics.cpi < 0.97) || overdue > 0) {
      label = "Watch";
      copy = "Minor schedule or cost variance needs attention.";
      score = 68;
      color = "var(--orange)";
    }
    document.getElementById("sidebar-health-label").textContent = label;
    document.getElementById("sidebar-health-copy").textContent = copy;
    const bar = document.getElementById("sidebar-health-bar");
    bar.style.width = `${score}%`;
    bar.style.background = color;
  }

  function renderDashboard(schedule) {
    const metrics = calculatePerformance(schedule);
    const now = new Date();
    document.getElementById("dashboard-date-chip").textContent = formatLongDate(now);
    document.getElementById("dashboard-subtitle").textContent = `${state.tasks.length} tasks · ${formatDate(schedule.projectStart, true)} to ${formatDate(schedule.projectFinishDate, true)} · ${state.project.calendar} ${state.project.forecast ? "Forecast" : "Plan"}`;

    const plannedPct = metrics.totalPlanned ? metrics.plannedValue / metrics.totalPlanned * 100 : 0;
    const progressDelta = metrics.overallProgress - plannedPct;
    const remainingBudget = state.project.budget - metrics.totalPlanned;
    const daysRemaining = diffDays(startOfDay(new Date()), schedule.projectFinishDate);
    const cpiClass = performanceClass(metrics.cpi);

    document.getElementById("dashboard-kpis").innerHTML = [
      kpiCard({ label: "Overall progress", value: `${round1(metrics.overallProgress)}%`, icon: "↗", iconClass: "blue", metaLeft: `${formatSigned(progressDelta, 1)} pts vs plan`, metaClass: progressDelta >= -3 ? "good" : "bad", metaRight: `${state.tasks.filter((task) => task.progress === 100).length}/${state.tasks.length} complete`, progress: metrics.overallProgress }),
      kpiCard({ label: "Forecast finish", value: formatDate(schedule.projectFinishDate, true), icon: "◷", iconClass: daysRemaining < 0 ? "red" : "purple", metaLeft: daysRemaining >= 0 ? `${daysRemaining} days remaining` : `${Math.abs(daysRemaining)} days elapsed`, metaClass: daysRemaining >= 0 ? "neutral" : "bad", metaRight: `${schedule.rows.filter((row) => row.critical).length} critical tasks` }),
      kpiCard({ label: "Committed budget", value: formatCompactCurrency(metrics.totalPlanned), icon: "฿", iconClass: remainingBudget >= 0 ? "green" : "red", metaLeft: remainingBudget >= 0 ? `${formatCompactCurrency(remainingBudget)} headroom` : `${formatCompactCurrency(Math.abs(remainingBudget))} over budget`, metaClass: remainingBudget >= 0 ? "good" : "bad", metaRight: `${round1(state.project.budget ? metrics.totalPlanned / state.project.budget * 100 : 0)}% of approval` }),
      kpiCard({ label: "Cost performance", value: metrics.cpi ? metrics.cpi.toFixed(2) : "—", icon: "◎", iconClass: cpiClass === "good" ? "green" : cpiClass === "bad" ? "red" : "orange", metaLeft: metrics.cpi ? (metrics.cpi >= 1 ? "Under earned budget" : "Over earned budget") : "Awaiting actual cost", metaClass: cpiClass, metaRight: `AC ${formatCompactCurrency(metrics.actualCost)}` })
    ].join("");

    renderMiniGantt(schedule);
    renderPriorities(schedule);
    renderSCurve("dashboard-scurve", schedule, true);
    renderStatusBreakdown();
  }

  function kpiCard({ label, value, icon, iconClass, metaLeft, metaClass = "neutral", metaRight, progress }) {
    return `<article class="kpi-card">
      <div class="kpi-topline"><span class="kpi-label">${escapeHtml(label)}</span><span class="kpi-icon ${iconClass}">${escapeHtml(icon)}</span></div>
      <strong class="kpi-value" title="${escapeHtml(value)}">${escapeHtml(value)}</strong>
      <div class="kpi-meta"><span class="delta ${metaClass}">${escapeHtml(metaLeft || "")}</span><span>${escapeHtml(metaRight || "")}</span></div>
      ${Number.isFinite(progress) ? `<div class="mini-progress"><span style="width:${clampNumber(progress, 0, 100, 0)}%"></span></div>` : ""}
    </article>`;
  }

  function renderMiniGantt(schedule) {
    const active = schedule.rows
      .filter((row) => row.task.progress < 100)
      .sort((a, b) => Number(b.critical) - Number(a.critical) || a.es - b.es)
      .slice(0, 6);
    const total = Math.max(1, schedule.projectFinishIndex + 1);
    const host = document.getElementById("dashboard-gantt");
    if (!active.length) {
      host.innerHTML = '<div class="empty-state">All tasks are complete. Add a new task to extend the project schedule.</div>';
      return;
    }
    host.innerHTML = active.map((row) => {
      const left = row.es / total * 100;
      const width = Math.max(2, row.duration / total * 100);
      const progressWidth = width * row.task.progress / 100;
      return `<div class="mini-gantt-row ${row.critical ? "critical" : ""}" data-edit-task="${escapeAttr(row.task.id)}">
        <div class="mini-gantt-label"><strong>${escapeHtml(row.task.name)}</strong><small>${escapeHtml(row.task.id)} · ${escapeHtml(row.task.owner || "Unassigned")}</small></div>
        <div class="mini-gantt-track"><span class="mini-gantt-bar" style="left:${left}%;width:${width}%"></span><span class="mini-gantt-progress" style="left:${left}%;width:${progressWidth}%"></span></div>
        <span class="mini-gantt-date">${formatDate(row.endDate)}</span>
      </div>`;
    }).join("");
  }

  function renderPriorities(schedule) {
    const today = startOfDay(new Date());
    const priorityRows = schedule.rows
      .filter((row) => row.task.progress < 100)
      .map((row) => {
        const overdue = row.endDate < today;
        const daysToFinish = diffDays(today, row.endDate);
        const score = (overdue ? 1000 : 0) + (row.critical ? 300 : 0) - daysToFinish;
        return { row, overdue, daysToFinish, score };
      })
      .filter((item) => item.overdue || item.row.critical || item.daysToFinish <= 14)
      .sort((a, b) => b.score - a.score)
      .slice(0, 6);

    document.getElementById("priority-count").textContent = String(priorityRows.length);
    const host = document.getElementById("priority-list");
    if (!priorityRows.length) {
      host.innerHTML = '<div class="empty-state">No immediate schedule exceptions.</div>';
      return;
    }
    host.innerHTML = priorityRows.map(({ row, overdue, daysToFinish }) => {
      const classification = overdue ? "overdue" : row.critical ? "critical" : "";
      const summary = overdue ? `${Math.abs(daysToFinish)} day${Math.abs(daysToFinish) === 1 ? "" : "s"} overdue` : row.critical ? `Critical path · ${row.slack}d float` : `Due in ${daysToFinish} days`;
      return `<div class="priority-item ${classification}" data-edit-task="${escapeAttr(row.task.id)}">
        <span class="priority-dot"></span>
        <div class="priority-copy"><strong>${escapeHtml(row.task.name)}</strong><small>${escapeHtml(summary)} · ${row.task.progress}% complete</small></div>
        <span class="priority-date">${formatDate(row.endDate)}</span>
      </div>`;
    }).join("");
  }

  function renderStatusBreakdown() {
    const counts = Object.fromEntries(STATUS_ORDER.map((status) => [status, 0]));
    state.tasks.forEach((task) => counts[task.status]++);
    const total = Math.max(1, state.tasks.length);
    document.getElementById("status-breakdown").innerHTML = STATUS_ORDER.map((status) => `<div class="status-row">
      <label>${STATUS_META[status].label}</label>
      <div class="status-bar-track"><div class="status-bar-fill status-${status}" style="width:${counts[status] / total * 100}%"></div></div>
      <strong>${counts[status]}</strong>
    </div>`).join("");
  }

  function renderSchedule(schedule) {
    currentSchedule = schedule;
    document.querySelectorAll("[data-zoom]").forEach((button) => button.classList.toggle("active", button.dataset.zoom === state.ui.zoom));
    const search = document.getElementById("task-search");
    if (search && search.value !== state.ui.search) search.value = state.ui.search;
    document.getElementById("gantt-scurve-toggle").checked = Boolean(state.ui.showGanttSCurve);
    document.getElementById("gantt-scurve-period").value = state.ui.curvePeriod || "month";

    const query = state.ui.search.trim().toLowerCase();
    let rows = applyCollapsedWbs(schedule.rows).filter((row) => !query || [row.task.id, row.task.name, row.task.owner, row.task.predecessor, row.task.status].some((value) => String(value || "").toLowerCase().includes(query)));
    if (state.ui.ganttCriticalMode === "only") rows = rows.filter((row) => row.critical || summaryContainsCritical(row, schedule.rows));
    const widthInput = document.getElementById("gantt-table-width"); if (widthInput) widthInput.value = state.ui.ganttTableWidth;
    document.getElementById("gantt-table-toggle").textContent = state.ui.ganttTableVisible ? "Hide table" : "Show table";
    document.querySelectorAll("[data-gantt-column]").forEach((input) => input.checked = state.ui.ganttColumns.includes(input.dataset.ganttColumn));
    document.querySelectorAll("[data-gantt-critical]").forEach((button) => button.classList.toggle("active", button.dataset.ganttCritical === state.ui.ganttCriticalMode));
    document.getElementById("schedule-range-label").textContent = `${formatDate(schedule.projectStart, true)} — ${formatDate(schedule.projectFinishDate, true)}`;
    renderScheduleAlerts(schedule);
    renderGantt(rows, schedule);
    renderTaskTable(rows);
    renderGanttSCurve(schedule);
    document.getElementById("task-table-summary").textContent = `${rows.length} of ${state.tasks.length} tasks · ${schedule.rows.filter((row) => row.critical).length} critical`;
  }

  function applyCollapsedWbs(rows) {
    const collapsed = new Set((state.ui.collapsedWbs || []).map((id) => id.toUpperCase()));
    const hiddenLevels = [];
    return rows.filter((row) => {
      const level = Number(row.task.outlineLevel || 1);
      while (hiddenLevels.length && level <= hiddenLevels.at(-1)) hiddenLevels.pop();
      const hidden = hiddenLevels.length > 0;
      if (collapsed.has(row.task.id.toUpperCase())) hiddenLevels.push(level);
      return !hidden;
    });
  }

  function summaryContainsCritical(row, allRows) {
    if (!row.task.summary) return false;
    const index = allRows.indexOf(row), level = Number(row.task.outlineLevel || 1);
    for (let i = index + 1; i < allRows.length && Number(allRows[i].task.outlineLevel || 1) > level; i++) if (allRows[i].critical) return true;
    return false;
  }

  function renderScheduleAlerts(schedule) {
    const alerts = [...schedule.issues];
    const overdue = schedule.rows.filter((row) => row.endDate < startOfDay(new Date()) && row.task.progress < 100);
    if (overdue.length) alerts.push({ type: "warning", message: `${overdue.length} task${overdue.length === 1 ? " is" : "s are"} past planned finish and not complete.` });
    const host = document.getElementById("schedule-alerts");
    host.innerHTML = alerts.slice(0, 6).map((alert) => `<div class="alert ${alert.type}"><span class="alert-icon">${alert.type === "error" ? "!" : alert.type === "warning" ? "△" : "i"}</span><div><strong>${alert.type === "error" ? "Scheduling error" : alert.type === "warning" ? "Schedule warning" : "Information"}</strong>${escapeHtml(alert.message)}</div></div>`).join("");
  }

  function renderGantt(rows, schedule) {
    const columnMeta = { id:["ID","48px"], wbs:["WBS","62px"], name:["Task name","minmax(150px,1fr)"], start:["Start","72px"], finish:["Finish","72px"], days:["Days","42px"], tf:["TF","38px"], plan:["% Plan","52px"], actual:["% Act.","52px"], status:["Status","82px"] };
    const columns = (state.ui.ganttColumns || []).filter((key) => columnMeta[key]);
    const grid = columns.map((key) => columnMeta[key][1]).join(" ");
    const cell = (key, value, cls = key) => columns.includes(key) ? `<span class="gantt-col ${cls}">${value}</span>` : "";
    const zoom = ZOOM[state.ui.zoom] || ZOOM.week;
    const baselineFinishIndex = Math.max(0, ...state.tasks.filter((task) => task.baselineFinish).map((task) => diffDays(schedule.projectStart, fromISO(task.baselineFinish))));
    const totalDays = Math.max(35, schedule.projectFinishIndex + 8, baselineFinishIndex + 8);
    const timelineWidth = totalDays * zoom.px;
    const rowHeight = 44;
    const headerHeight = 62;
    const months = buildMonthBands(schedule.projectStart, totalDays, zoom.px);
    const ticks = [];
    for (let day = 0; day < totalDays; day += zoom.tick) {
      const date = addDays(schedule.projectStart, day);
      const label = state.ui.zoom === "day" ? formatDayShort(date) : state.ui.zoom === "week" ? formatDate(date) : formatMonthDay(date);
      ticks.push(`<span class="gantt-tick-label" style="left:${day * zoom.px}px;width:${zoom.tick * zoom.px}px">${escapeHtml(label)}</span>`);
    }

    const visibleIds = new Set(rows.map((row) => row.task.id.toUpperCase()));
    const indexById = new Map(rows.map((row, index) => [row.task.id.toUpperCase(), index]));
    const links = [];
    rows.forEach((row, rowIndex) => {
      row.predecessors.forEach((pred) => {
        if (!visibleIds.has(pred.id)) return;
        const predecessor = schedule.byId.get(pred.id);
        const predecessorIndex = indexById.get(pred.id);
        if (!predecessor || predecessorIndex === undefined) return;
        const fromFinish = pred.type === "FS" || pred.type === "FF";
        const toFinish = pred.type === "FF" || pred.type === "SF";
        const x1 = (fromFinish ? predecessor.ef + 1 : predecessor.es) * zoom.px - (fromFinish ? 3 : -3);
        const x2 = (toFinish ? row.ef + 1 : row.es) * zoom.px + (toFinish ? -3 : 3);
        const y1 = predecessorIndex * rowHeight + rowHeight / 2;
        const y2 = rowIndex * rowHeight + rowHeight / 2;
        const elbow = x2 > x1 ? x1 + Math.max(8, (x2 - x1) / 2) : x1 + 12;
        const path = `M ${x1} ${y1} H ${elbow} V ${y2} H ${x2}`;
        const label = `${pred.type}${pred.lag > 0 ? `+${pred.lag}` : pred.lag < 0 ? pred.lag : ""}`;
        links.push(`<path class="gantt-link-path" d="${path}" marker-end="url(#ganttArrow)"></path><text class="gantt-link-label" x="${elbow + 4}" y="${Math.min(y1, y2) + Math.abs(y2 - y1) / 2 - 4}">${escapeHtml(label)}</text>`);
      });
    });

    const todayLine = schedule.todayIndex >= 0 && schedule.todayIndex < totalDays
      ? `<div class="gantt-today" style="left:calc(var(--label-width) + ${schedule.todayIndex * zoom.px}px)" title="Data Date ${escapeAttr(state.project.dataDate)}"><span>DATA DATE</span></div>`
      : "";

    const rowMarkup = rows.length ? rows.map((row) => {
      const left = row.es * zoom.px + 3;
      const width = Math.max(9, row.duration * zoom.px - 6);
      const baselineStart = row.task.baselineStart ? diffDays(schedule.projectStart, fromISO(row.task.baselineStart)) : null;
      const baselineFinish = row.task.baselineFinish ? diffDays(schedule.projectStart, fromISO(row.task.baselineFinish)) : null;
      const baseline = baselineStart !== null && baselineFinish !== null ? `<div class="gantt-baseline-bar" style="left:${baselineStart * zoom.px + 3}px;width:${Math.max(9, (baselineFinish - baselineStart + 1) * zoom.px - 6)}px" title="Baseline ${escapeAttr(row.task.baselineStart)} — ${escapeAttr(row.task.baselineFinish)}"></div>` : "";
      const collapsed = (state.ui.collapsedWbs || []).map((id) => id.toUpperCase()).includes(row.task.id.toUpperCase());
      const taskName = `${row.task.summary ? `<button class="wbs-toggle" type="button" data-wbs-toggle="${escapeAttr(row.task.id)}">${collapsed ? "▸" : "▾"}</button>` : ""}<strong>${escapeHtml(row.task.name)}</strong>`;
      return `<div class="gantt-row ${row.critical ? "is-critical" : "is-noncritical"}">
        <div class="gantt-task-label gantt-register-row ${row.task.summary ? "summary" : ""}" data-edit-task="${escapeAttr(row.task.id)}">
          ${cell("id", escapeHtml(row.task.id))}${cell("wbs", escapeHtml(row.task.wbs || "—"))}
          ${columns.includes("name") ? `<span class="gantt-col name" style="--outline:${Math.max(0, Number(row.task.outlineLevel || 1) - 1)}">${taskName}</span>` : ""}
          ${cell("start", formatDate(row.startDate), "date")}${cell("finish", formatDate(row.endDate), "date")}${cell("days", row.task.milestone ? "◆ 0" : row.workDuration ?? (row.task.sourceDuration || row.duration))}${cell("tf", row.slack ?? "—")}${cell("plan", `${round1(plannedFraction(row, schedule.todayIndex) * 100)}%`)}${cell("actual", `${row.task.progress}%`)}${cell("status", row.task.progress >= 100 ? "DONE" : row.task.progress > 0 ? "IN PROGRESS" : "NOT START", "state")}
        </div>
        <div class="gantt-timeline-row" style="--day-px:${zoom.px}px">
          ${baseline}
          <div class="gantt-bar ${row.task.milestone ? "milestone-bar" : ""} status-${row.task.status} ${row.critical ? "critical" : row.slack <= 5 ? "near-critical" : "normal-float"}" style="left:${left}px;width:${width}px" data-edit-task="${escapeAttr(row.task.id)}" title="${escapeAttr(`${row.task.id} · ${row.task.name}\n${formatDate(row.startDate, true)} — ${formatDate(row.endDate, true)}\nTF ${row.slack}d · ${row.task.progress}% complete`)}">
            <span class="gantt-bar-progress" style="width:${row.task.progress}%"></span>
            <span class="gantt-bar-text">${width > 80 ? escapeHtml(row.task.name) : escapeHtml(row.task.id)}</span>
          </div>
        </div>
      </div>`;
    }).join("") : `<div class="empty-state" style="margin:14px">No tasks match the current search.</div>`;

    document.getElementById("gantt-chart").innerHTML = `<div class="gantt-inner ${state.ui.ganttTableVisible ? "" : "table-hidden"} ${state.ui.ganttCriticalMode === "highlight" ? "critical-focus" : ""}" style="--timeline-width:${timelineWidth}px;--label-width:${state.ui.ganttTableVisible ? state.ui.ganttTableWidth : 0}px;--register-grid:${grid}">
      <div class="gantt-header">
        <div class="gantt-corner gantt-register-header">${columns.map((key) => `<span>${columnMeta[key][0]}</span>`).join("")}</div>
        <div class="gantt-header-timeline">${months}${ticks.join("")}</div>
      </div>
      ${rows.length ? `<svg class="gantt-links" style="left:var(--label-width);top:${headerHeight}px" width="${timelineWidth}" height="${rows.length * rowHeight}" viewBox="0 0 ${timelineWidth} ${rows.length * rowHeight}" aria-hidden="true"><defs><marker id="ganttArrow" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto"><path class="gantt-link-arrow" d="M0,0 L7,3.5 L0,7 Z"></path></marker></defs>${links.join("")}</svg>` : ""}
      ${todayLine}
      ${rowMarkup}
      ${state.ui.showGanttSCurve ? buildGanttOverlaySvg(schedule, timelineWidth, rows.length * rowHeight, headerHeight) : ""}
    </div>`;
  }

  function buildMonthBands(start, totalDays, pxPerDay) {
    const groups = [];
    let groupStart = 0;
    let currentKey = monthKey(start);
    for (let index = 1; index <= totalDays; index++) {
      const date = addDays(start, index);
      const key = monthKey(date);
      if (index === totalDays || key !== currentKey) {
        const firstDate = addDays(start, groupStart);
        groups.push({ start: groupStart, days: index - groupStart, label: formatMonthYear(firstDate) });
        groupStart = index;
        currentKey = key;
      }
    }
    return groups.map((group) => `<span class="gantt-month-band" style="left:${group.start * pxPerDay}px;width:${group.days * pxPerDay}px">${escapeHtml(group.label)}</span>`).join("");
  }

  function buildProgressSeries(schedule) {
    const baselineFinishIndex = Math.max(0, ...state.tasks.filter((task) => task.baselineFinish).map((task) => diffDays(schedule.projectStart, fromISO(task.baselineFinish))));
    const totalDays = Math.max(1, schedule.projectFinishIndex + 1, baselineFinishIndex + 1, schedule.todayIndex + 1);
    const hasBaseline = state.tasks.some((task) => task.baselineStart && task.baselineFinish);
    const monetaryWeights=state.tasks.some(task=>!task.summary&&Number(hasBaseline?task.baselineCost||task.cost||0:task.cost||0)>0);
    const weightFor=task=>monetaryWeights?Number(hasBaseline?task.baselineCost||task.cost||0:task.cost||0):Number(task.milestone?0:task.duration||0);
    const weightTotal = Math.max(1, state.tasks.filter(task=>!task.summary).reduce((sum, task) => sum + weightFor(task), 0));
    const plan = [], actual = [], cash = [];
    for (let day = 0; day < totalDays; day++) {
      let plannedValue = 0, actualValue = 0, actualCost = 0;
      schedule.rows.forEach((row) => {
        if (row.task.summary) return;
        const weight = weightFor(row.task);
        if (hasBaseline && row.task.baselineStart && row.task.baselineFinish) {
          const bs = diffDays(schedule.projectStart, fromISO(row.task.baselineStart));
          const bf = diffDays(schedule.projectStart, fromISO(row.task.baselineFinish));
          const fraction = day < bs ? 0 : day >= bf ? 1 : clampNumber(workdaysBetween(fromISO(row.task.baselineStart),addDays(schedule.projectStart,day))/Math.max(1,workdaysBetween(fromISO(row.task.baselineStart),fromISO(row.task.baselineFinish))), 0, 1, 0);
          plannedValue += weight * fraction;
        } else plannedValue += weight * plannedFraction(row, day);
        actualValue += weight * actualAt(row.task, addDays(schedule.projectStart,day)).progress / 100;
        actualCost += actualAt(row.task,addDays(schedule.projectStart,day)).cost;
      });
      plan.push(plannedValue / weightTotal * 100);
      actual.push(actualValue / weightTotal * 100);
      cash.push(actualCost);
    }
    return { plan, actual, cash, weightTotal, monetaryWeights };
  }

  function buildGanttOverlaySvg(schedule, width, rowsHeight, headerHeight) {
    const series = buildProgressSeries(schedule);
    const zoom = ZOOM[state.ui.zoom] || ZOOM.week;
    const chartHeight = Math.max(150, rowsHeight);
    const points = (values) => values.map((value, day) => `${day * zoom.px + zoom.px / 2},${chartHeight - value / 100 * (chartHeight - 20)}`).join(" ");
    return `<svg class="gantt-progress-overlay" style="left:var(--label-width);top:${headerHeight}px" width="${width}" height="${chartHeight}" viewBox="0 0 ${width} ${chartHeight}" aria-hidden="true"><polyline class="gantt-overlay-plan" points="${points(series.plan)}"></polyline><polyline class="gantt-overlay-actual" points="${points(series.actual)}"></polyline></svg>`;
  }

  function renderGanttSCurve(schedule) {
    const host = document.getElementById("gantt-scurve-overlay");
    const table = document.getElementById("gantt-scurve-table");
    const series = buildProgressSeries(schedule);
    const period = state.ui.curvePeriod === "month" ? "month" : "week";
    const buckets = progressBuckets(schedule,series,period);
    const width = 1000, height = 270, left = 58, right = 22, top = 18, bottom = 34;
    const x = (index) => left + (buckets.length <= 1 ? 0 : index / (buckets.length - 1) * (width - left - right));
    const y = (value) => top + (100 - value) / 100 * (height - top - bottom);
    const path = (key) => buckets.map((b, i) => `${i ? "L" : "M"}${x(i)},${y(b[key])}`).join(" ");
    host.innerHTML = `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Planned and actual cumulative construction progress S-curve"><g>${[0,25,50,75,100].map((v) => `<line class="chart-grid-line" x1="${left}" x2="${width-right}" y1="${y(v)}" y2="${y(v)}"></line><text class="chart-axis-text" x="${left-10}" y="${y(v)+4}" text-anchor="end">${v}%</text>`).join("")}</g><path class="curve-plan-line" d="${path("sumPlan")}"></path><path class="curve-actual-line" d="${path("sumActual")}"></path>${buckets.map((b,i)=>`<text class="chart-axis-text" x="${x(i)}" y="${height-10}" text-anchor="middle">${escapeHtml(formatDate(addDays(schedule.projectStart,b.end)))}</text>`).join("")}</svg><div class="curve-legend"><span><i class="curve-key plan"></i>Sum Plan</span><span><i class="curve-key actual"></i>Sum Actual</span></div>`;
    const monthGroups = [];
    buckets.forEach((bucket) => {
      const label = formatMonthYear(addDays(schedule.projectStart, bucket.end));
      const last = monthGroups[monthGroups.length - 1];
      if (last && last.label === label) last.count++;
      else monthGroups.push({ label, count: 1 });
    });
    const value = (number, currency = false) => currency ? formatCompactCurrency(number) : `${round1(number)}%`;
    const row = (section, label, key, cumulative = false, currency = false) => `<tr class="${cumulative ? "cumulative" : ""}"><th class="matrix-section">${section}</th><th>${label}</th>${buckets.map((b) => `<td>${currency&&!series.monetaryWeights?"—":value(currency ? series.weightTotal * b[key] / 100 : b[key], currency)}</td>`).join("")}</tr>`;
table.innerHTML = `<caption>Data Date ${escapeHtml(state.project.dataDate)} · Actual % ถ่วงน้ำหนัก \${series.monetaryWeights?'งบประมาณ':'ระยะเวลา (ไม่มีงบประมาณ)'} · มูลค่าผลงานไม่ใช่ค่าใช้จ่าย · ${state.tasks.filter(t=>!t.summary&&!t.actualHistory?.length).length} งานไม่มีประวัติ ใช้ snapshot ณ Data Date · เดือนจัดตามวันสิ้นงวดสัปดาห์</caption><thead><tr><th rowspan="2" class="matrix-corner">Type</th><th rowspan="2" class="matrix-metric">Progress control</th>${monthGroups.map((group) => `<th colspan="${group.count}" class="matrix-month">${escapeHtml(group.label)}</th>`).join("")}</tr><tr>${buckets.map((b, i) => `<th class="matrix-period">${period === "week" ? `W${i + 1}<small>${formatDate(addDays(schedule.projectStart, b.start))}–${formatDate(addDays(schedule.projectStart, b.end))}</small>` : formatMonthDay(addDays(schedule.projectStart, b.end))}</th>`).join("")}</tr></thead><tbody>
      ${row("PLAN", "Plan / period", "plan")}${row("", "Sum Plan", "sumPlan", true)}${row("", "Plan value / period", "plan", false, true)}${row("", "Sum Plan value", "sumPlan", true, true)}
      ${row("ACTUAL", "Actual / period", "actual")}${row("", "Sum Actual", "sumActual", true)}${row("", "Actual value / period", "actual", false, true)}${row("", "Sum Actual value", "sumActual", true, true)}
      <tr><th>ค่าใช้จ่าย</th><th>รายงวด</th>${buckets.map(b=>`<td>${formatCompactCurrency(b.cash)}</td>`).join("")}</tr><tr class="cumulative"><th></th><th>ค่าใช้จ่ายสะสม</th>${buckets.map(b=>`<td>${formatCompactCurrency(b.sumCash)}</td>`).join("")}</tr>
    </tbody>`;
  }

  function progressBuckets(schedule,series,period) {
    const weekly=[];
    for(let start=0;start<series.plan.length;start+=7){const end=Math.min(series.plan.length-1,start+6),prior=weekly.at(-1);weekly.push({start,end,sumPlan:series.plan[end],sumActual:series.actual[end],sumCash:series.cash[end],plan:series.plan[end]-(prior?.sumPlan||0),actual:series.actual[end]-(prior?.sumActual||0),cash:series.cash[end]-(prior?.sumCash||0),month:monthKey(addDays(schedule.projectStart,end))});}
    if(period==="week")return weekly;
    return [...weekly.reduce((groups,w)=>{if(!groups.has(w.month))groups.set(w.month,{...w,plan:0,actual:0,cash:0});const m=groups.get(w.month);m.end=w.end;m.sumPlan=w.sumPlan;m.sumActual=w.sumActual;m.sumCash=w.sumCash;m.plan+=w.plan;m.actual+=w.actual;m.cash+=w.cash;return groups;},new Map()).values()];
  }

  function renderTaskTable(rows) {
    const body = document.getElementById("task-table-body");
    if (!rows.length) {
      body.innerHTML = '<tr><td colspan="16"><div class="empty-state">No tasks match the current search.</div></td></tr>';
      return;
    }
    body.innerHTML = rows.map((row) => `<tr>
      <td><span class="id-pill">${escapeHtml(row.task.id)}</span>${row.critical ? '<span class="critical-pill">Critical</span>' : ""}</td>
      <td class="task-cell"><strong>${escapeHtml(row.task.name)}</strong><small>${escapeHtml(row.task.wbs || "General")} · ${escapeHtml(row.task.notes || "No task note")}</small></td>
      <td>${escapeHtml(row.task.owner || "Unassigned")}</td>
      <td class="numeric">${row.task.milestone ? "◆ 0" : row.workDuration ?? (row.task.sourceDuration || row.duration)}d</td>
      <td class="numeric"><span class="float-pill ${row.critical ? "critical" : row.slack <= 5 ? "near" : "normal"}">${row.slack ?? "—"}</span></td>
      <td>${row.predecessors.length ? row.predecessors.map((pred) => `<code class="dependency-chip">${escapeHtml(dependencyLabel(pred))}</code>`).join(" ") : "—"}</td>
      <td>${formatDate(row.startDate)}</td>
      <td>${formatDate(row.endDate)}</td>
      <td>${row.task.baselineStart ? formatDate(fromISO(row.task.baselineStart)) : "—"}</td>
      <td>${row.task.baselineFinish ? formatDate(fromISO(row.task.baselineFinish)) : "—"}</td>
      <td class="numeric">${formatCompactCurrency(row.task.cost)}</td>
      <td>${escapeHtml(row.task.resourceTeam || row.task.owner || "—")}</td>
      <td class="numeric">${manpowerFor(row.task)}</td>
      <td class="progress-cell"><div class="progress-control"><input type="range" min="0" max="100" step="5" value="${row.task.progress}" data-progress-label-for="${escapeAttr(row.task.id)}" aria-label="${escapeAttr(`Progress for ${row.task.name}`)}"><span data-progress-value="${escapeAttr(row.task.id)}">${row.task.progress}%</span></div></td>
      <td><span class="status-pill ${row.task.status}">${STATUS_META[row.task.status].label}</span></td>
      <td><button class="row-action" type="button" data-edit-task="${escapeAttr(row.task.id)}" aria-label="Edit ${escapeAttr(row.task.name)}">···</button></td>
    </tr>`).join("");
  }

  function scrollGanttToToday() {
    const shell = document.getElementById("gantt-chart");
    if (!shell || !currentSchedule) return;
    const zoom = ZOOM[state.ui.zoom] || ZOOM.week;
    if (currentSchedule.todayIndex < 0 || currentSchedule.todayIndex > currentSchedule.projectFinishIndex + 8) {
      showToast("Today is outside the current project timeline.");
      return;
    }
    shell.scrollTo({ left: Math.max(0, currentSchedule.todayIndex * zoom.px - shell.clientWidth / 2 + 130), behavior: "smooth" });
  }

  function renderCriticalPath(schedule, fit = false) {
    const onlyCritical = Boolean(state.ui.criticalOnly);
    document.getElementById("critical-only-button").classList.toggle("active", onlyCritical);
    document.getElementById("critical-all-button").classList.toggle("active", !onlyCritical);
    const alerts = document.getElementById("critical-alerts");
    alerts.innerHTML = schedule.issues.map((issue) => `<div class="alert ${issue.type}"><span class="alert-icon">${issue.type === "error" ? "!" : "△"}</span><div><strong>${issue.type === "error" ? "Scheduling error" : "Schedule warning"}</strong>${escapeHtml(issue.message)}</div></div>`).join("");

    const included = schedule.rows.filter((row) => !onlyCritical || row.critical);
    const includedIds = new Set(included.map((row) => row.task.id.toUpperCase()));
    const level = new Map();
    schedule.topo.forEach((id) => {
      const row = schedule.byId.get(id);
      if (!row || !includedIds.has(id)) return;
      const priorLevels = row.predecessors.filter((pred) => includedIds.has(pred.id)).map((pred) => level.get(pred.id) ?? 0);
      level.set(id, priorLevels.length ? Math.max(...priorLevels) + 1 : 0);
    });
    included.forEach((row) => { if (!level.has(row.task.id.toUpperCase())) level.set(row.task.id.toUpperCase(), 0); });
    const columns = new Map();
    included.forEach((row) => {
      const column = level.get(row.task.id.toUpperCase()) || 0;
      if (!columns.has(column)) columns.set(column, []);
      columns.get(column).push(row);
    });
    const nodeW = 226, nodeH = 116, gapX = 100, gapY = 32, pad = 28;
    const positions = new Map();
    [...columns.entries()].sort((a, b) => a[0] - b[0]).forEach(([column, rows]) => {
      rows.sort((a, b) => a.es - b.es || a.task.id.localeCompare(b.task.id));
      rows.forEach((row, index) => positions.set(row.task.id.toUpperCase(), { x: pad + column * (nodeW + gapX), y: pad + index * (nodeH + gapY) }));
    });
    const maxLevel = Math.max(0, ...level.values());
    const maxRows = Math.max(1, ...[...columns.values()].map((rows) => rows.length));
    const diagramW = pad * 2 + (maxLevel + 1) * nodeW + maxLevel * gapX;
    const diagramH = pad * 2 + maxRows * nodeH + (maxRows - 1) * gapY;
    const links = [];
    included.forEach((row) => row.predecessors.forEach((pred) => {
      if (!includedIds.has(pred.id)) return;
      const from = positions.get(pred.id), to = positions.get(row.task.id.toUpperCase());
      if (!from || !to) return;
      const x1 = from.x + nodeW, y1 = from.y + nodeH / 2, x2 = to.x, y2 = to.y + nodeH / 2;
      const mid = x1 + Math.max(32, (x2 - x1) / 2);
      const criticalLink = schedule.byId.get(pred.id)?.critical && row.critical;
      const edgeLabel = `${pred.type}${pred.lag > 0 ? `+${pred.lag}` : pred.lag < 0 ? pred.lag : ""}`;
      links.push(`<path class="network-link ${criticalLink ? "critical" : ""}" d="M${x1},${y1} H${mid} V${y2} H${x2}" marker-end="url(#networkArrow${criticalLink ? "Critical" : ""})"></path><text class="network-link-label" x="${mid + 5}" y="${(y1 + y2) / 2 - 5}">${escapeHtml(edgeLabel)}</text>`);
    }));
    const nodes = included.map((row) => {
      const p = positions.get(row.task.id.toUpperCase());
      return `<g class="network-node ${row.critical ? "critical" : ""}" transform="translate(${p.x} ${p.y})" data-edit-task="${escapeAttr(row.task.id)}" tabindex="0" role="button" aria-label="Edit ${escapeAttr(row.task.name)}">
        <rect width="${nodeW}" height="${nodeH}" rx="13"></rect>
        <line x1="0" y1="34" x2="${nodeW}" y2="34"></line>
        <text class="network-node-id" x="14" y="23">${escapeHtml(row.task.id)}</text><text class="network-node-status" x="${nodeW - 14}" y="23" text-anchor="end">${row.critical ? "CRITICAL" : `${row.slack}d FLOAT`}</text>
        <text class="network-node-name" x="14" y="55">${escapeHtml(truncate(row.task.name, 28))}</text>
        <text class="network-node-metric" x="14" y="78">ES ${row.es}  ·  EF ${row.ef}</text><text class="network-node-metric" x="14" y="99">LS ${row.ls ?? "—"}  ·  LF ${row.lf ?? "—"}  ·  TF ${row.slack ?? "—"}</text>
      </g>`;
    }).join("");
    const host = document.getElementById("critical-network");
    host.innerHTML = included.length ? `<svg width="100%" height="100%" viewBox="0 0 ${Math.max(720, host.clientWidth || 720)} ${Math.max(520, host.clientHeight || 520)}"><defs><marker id="networkArrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 Z"></path></marker><marker id="networkArrowCritical" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 Z"></path></marker></defs><g id="critical-network-stage">${links.join("")}${nodes}</g></svg>` : `<div class="empty-state">No critical activities are available.</div>`;
    document.getElementById("critical-network-summary").textContent = `${included.length} activities · ${schedule.rows.filter((row) => row.critical).length} critical · finish ${formatDate(schedule.projectFinishDate, true)}`;
    if (fit && included.length) {
      const availableW = Math.max(680, host.clientWidth || 960) - 24;
      const availableH = Math.max(480, host.clientHeight || 620) - 24;
      networkView = { scale: Math.min(1.2, availableW / diagramW, availableH / diagramH), x: 12, y: 12 };
    }
    applyNetworkTransform();
  }

  function applyNetworkTransform() {
    const stage = document.getElementById("critical-network-stage");
    if (stage) stage.setAttribute("transform", `translate(${networkView.x} ${networkView.y}) scale(${networkView.scale})`);
  }

  function changeNetworkZoom(factor) {
    networkView.scale = clampNumber(networkView.scale * factor, 0.25, 2.5, 1);
    applyNetworkTransform();
  }

  function printView(view) {
    const size = document.getElementById("print-paper-size")?.value === "A3" ? "A3" : "A4";
    let style = document.getElementById("dynamic-print-page");
    if (!style) { style = document.createElement("style"); style.id = "dynamic-print-page"; document.head.appendChild(style); }
    style.textContent = `@page { size: ${size} landscape; margin: 10mm; }`;
    document.body.dataset.printView = view;
    document.getElementById("schedule-print-sheet")?.remove();
    if(view==="schedule") {
      const chart=document.querySelector("#gantt-chart .gantt-inner");
      if(chart){
        const sheet=document.createElement("section");sheet.id="schedule-print-sheet";
        const clone=chart.cloneNode(true),matrix=document.querySelector(".gantt-scurve-panel")?.cloneNode(true);
        const paperWidth=(size==="A3"?420:297)-20,paperHeight=(size==="A3"?297:210)-20;
        const width=Math.max(chart.scrollWidth,chart.getBoundingClientRect().width);
        sheet.style.width=`${width}px`;
        sheet.innerHTML=`<header class="print-report-title"><h2>${escapeHtml(state.project.name)}</h2><p>Gantt & Progress · Data Date ${escapeHtml(state.project.dataDate)} · ${escapeHtml(state.project.calendar)} · ${state.ui.ganttCriticalMode} · ${size} Landscape</p></header>`;
        const arrow=clone.querySelector("#ganttArrow");if(arrow){arrow.id="printGanttArrow";clone.querySelectorAll("[marker-end]").forEach(el=>el.setAttribute("marker-end","url(#printGanttArrow)"));}
        clone.querySelectorAll("[id]").forEach(el=>{if(el.id!=="printGanttArrow")el.removeAttribute("id");});
        matrix?.querySelectorAll("[id]").forEach(el=>el.removeAttribute("id"));
        clone.style.width=`${width}px`;sheet.append(clone);
        if(matrix&&!document.body.classList.contains("pilot-hide-summary")){matrix.querySelector(".gantt-scurve-host")?.remove();matrix.querySelector(".panel-header")?.remove();sheet.append(matrix);}
        document.getElementById("view-schedule").prepend(sheet);
        // Physical fit includes both timeline and period table, not the viewport width.
        const fitWidth=paperWidth*96/25.4/width;
        const height=Math.max(sheet.scrollHeight,chart.scrollHeight+(matrix?matrix.scrollHeight:0)+110);
        const fitPage=paperHeight*96/25.4/Math.max(1,height);
        const mode=document.body.dataset.printFit||"page";
        sheet.style.setProperty("--report-print-scale",String(Math.min(1,fitWidth,mode==="page"?fitPage:1)));
      }
    }
    requestAnimationFrame(() => window.print());
  }

  window.addEventListener("afterprint", () => { delete document.body.dataset.printView;document.getElementById("schedule-print-sheet")?.remove(); });

  function truncate(value, max) {
    const text = String(value || "");
    return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
  }

  function renderKanban(schedule) {
    const ownerSelect = document.getElementById("kanban-owner-filter");
    const owners = [...new Set(state.tasks.map((task) => task.owner || "Unassigned"))].sort((a, b) => a.localeCompare(b));
    const selectedOwner = owners.includes(state.ui.ownerFilter) ? state.ui.ownerFilter : "all";
    state.ui.ownerFilter = selectedOwner;
    ownerSelect.innerHTML = '<option value="all">All owners</option>' + owners.map((owner) => `<option value="${escapeAttr(owner)}" ${selectedOwner === owner ? "selected" : ""}>${escapeHtml(owner)}</option>`).join("");

    const board = document.getElementById("kanban-board");
    board.innerHTML = STATUS_ORDER.map((status) => {
      const tasks = state.tasks.filter((task) => task.status === status && (selectedOwner === "all" || (task.owner || "Unassigned") === selectedOwner));
      const totalCost = tasks.reduce((sum, task) => sum + Number(task.cost || 0), 0);
      return `<section class="kanban-column" data-status="${status}">
        <div class="kanban-column-header">
          <div class="kanban-column-title"><i class="status-${status}"></i><strong>${STATUS_META[status].label}</strong></div>
          <div class="kanban-column-stats"><span>${formatCompactCurrency(totalCost)}</span><span class="kanban-count">${tasks.length}</span></div>
        </div>
        <div class="kanban-cards">${tasks.length ? tasks.map((task) => kanbanCard(task, schedule.byId.get(task.id.toUpperCase()))).join("") : '<div class="kanban-empty">Drop a task here</div>'}</div>
      </section>`;
    }).join("");
  }

  function kanbanCard(task, row) {
    return `<article class="kanban-card" draggable="true" data-task-id="${escapeAttr(task.id)}" data-edit-task="${escapeAttr(task.id)}">
      <div class="kanban-card-topline"><span class="kanban-card-id">${escapeHtml(task.id)}${row?.critical ? " · CRITICAL" : ""}</span><span class="kanban-card-cost">${formatCompactCurrency(task.cost)}</span></div>
      <h4>${escapeHtml(task.name)}</h4>
      <p>${escapeHtml(task.notes || "No task note")}</p>
      <div class="kanban-progress"><span style="width:${task.progress}%"></span></div>
      <div class="kanban-card-meta"><span class="avatar" title="${escapeAttr(task.owner || "Unassigned")}">${escapeHtml(initials(task.owner || "Unassigned"))}</span><span>${task.duration}d · due ${row ? formatDate(row.endDate) : "—"}</span><strong>${task.progress}%</strong></div>
    </article>`;
  }

  function renderCosts(schedule) {
    const metrics = calculatePerformance(schedule);
    const budget = Number(state.project.budget || 0);
    const eac = metrics.cpi && metrics.cpi > 0 ? budget / metrics.cpi : budget;
    const vac = budget - eac;
    document.getElementById("cost-kpis").innerHTML = [
      kpiCard({ label: "Approved budget", value: formatCompactCurrency(budget), icon: "B", iconClass: "blue", metaLeft: `${formatCompactCurrency(metrics.totalPlanned)} task budget`, metaClass: metrics.totalPlanned <= budget ? "good" : "bad", metaRight: `${round1(budget ? metrics.totalPlanned / budget * 100 : 0)}% committed` }),
      kpiCard({ label: "Planned value today", value: formatCompactCurrency(metrics.plannedValue), icon: "P", iconClass: "purple", metaLeft: `${round1(metrics.totalPlanned ? metrics.plannedValue / metrics.totalPlanned * 100 : 0)}% of task budget`, metaClass: "neutral", metaRight: `EV ${formatCompactCurrency(metrics.earnedValue)}` }),
      kpiCard({ label: "Actual cost", value: formatCompactCurrency(metrics.actualCost), icon: "A", iconClass: metrics.cpi && metrics.cpi >= 1 ? "green" : "orange", metaLeft: metrics.costVariance >= 0 ? `${formatCompactCurrency(metrics.costVariance)} favorable` : `${formatCompactCurrency(Math.abs(metrics.costVariance))} unfavorable`, metaClass: metrics.costVariance >= 0 ? "good" : "bad", metaRight: `CPI ${metrics.cpi ? metrics.cpi.toFixed(2) : "—"}` }),
      kpiCard({ label: "Estimate at completion", value: formatCompactCurrency(eac), icon: "F", iconClass: vac >= 0 ? "green" : "red", metaLeft: vac >= 0 ? `${formatCompactCurrency(vac)} forecast headroom` : `${formatCompactCurrency(Math.abs(vac))} forecast overrun`, metaClass: vac >= 0 ? "good" : "bad", metaRight: "BAC ÷ CPI" })
    ].join("");

    renderSCurve("cost-scurve", schedule, false);
    renderCostByStatus();
    renderEvmExplainer(metrics, eac, vac);
    renderCostTable(schedule);
  }

  function calculatePerformance(schedule) {
    const activities=state.tasks.filter(t=>!t.summary);
    const totalPlanned = activities.reduce((sum, task) => sum + Number(task.cost || 0), 0);
    const actualCost = activities.reduce((sum, task) => sum + actualAt(task,fromISO(state.project.dataDate)).cost, 0);
    const earnedValue = activities.reduce((sum, task) => sum + Number(task.cost || 0) * actualAt(task,fromISO(state.project.dataDate)).progress / 100, 0);
    const weight = totalPlanned > 0 ? totalPlanned : activities.reduce((sum, task) => sum + Number(task.duration || 0), 0);
    const weighted = activities.reduce((sum, task) => {
      const taskWeight = totalPlanned > 0 ? Number(task.cost || 0) : Number(task.duration || 0);
      return sum + taskWeight * actualAt(task,fromISO(state.project.dataDate)).progress / 100;
    }, 0);
    const overallProgress = weight ? weighted / weight * 100 : 0;
    const todayIndex = schedule.todayIndex;
    const plannedValue = schedule.rows.filter(r=>!r.task.summary).reduce((sum, row) => sum + Number(row.task.cost || 0) * plannedFraction(row, todayIndex), 0);
    const cpi = actualCost > 0 ? earnedValue / actualCost : null;
    const spi = plannedValue > 0 ? earnedValue / plannedValue : null;
    return {
      totalPlanned,
      actualCost,
      earnedValue,
      overallProgress,
      plannedValue,
      cpi,
      spi,
      costVariance: earnedValue - actualCost,
      scheduleVariance: earnedValue - plannedValue
    };
  }

  function isProjectWorkday(date) {
    return !(state.project.holidays||[]).includes(toISO(date)) && (state.project.calendar==="work5"?date.getDay()>0&&date.getDay()<6:state.project.calendar==="work6"?date.getDay()!==0:true);
  }
  function workdaysBetween(start,end) { let days=0; for(let date=start;date<=end;date=addDays(date,1))if(isProjectWorkday(date))days++;return days; }
  function plannedFraction(row, dayIndex) {
    if (dayIndex < row.es) return 0;
    if (dayIndex >= row.ef) return 1;
    if(row.workDuration!=null)return clampNumber(workdaysBetween(row.startDate,addDays(row.startDate,dayIndex-row.es))/Math.max(1,workdaysBetween(row.startDate,row.endDate)),0,1,0);
    return clampNumber((dayIndex - row.es + 1) / row.duration, 0, 1, 0);
  }

  function renderSCurve(containerId, schedule, compact) {
    const host = document.getElementById(containerId);
    if (!host) return;
    const curve = buildSCurve(schedule);
    const width = 960;
    const height = compact ? 255 : 395;
    const margin = compact ? { top: 20, right: 22, bottom: 34, left: 58 } : { top: 28, right: 30, bottom: 48, left: 72 };
    const plotW = width - margin.left - margin.right;
    const plotH = height - margin.top - margin.bottom;
    const maxValue = Math.max(1, ...curve.planned, ...curve.earned, ...curve.actual, Number(state.project.budget || 0) * 0.1);
    const niceMax = niceCeil(maxValue);
    const x = (index) => margin.left + (curve.dates.length <= 1 ? 0 : index / (curve.dates.length - 1) * plotW);
    const y = (value) => margin.top + plotH - value / niceMax * plotH;
    const path = (values) => values.map((value, index) => `${index === 0 ? "M" : "L"}${x(index).toFixed(2)},${y(value).toFixed(2)}`).join(" ");
    const plannedPath = path(curve.planned);
    const earnedPath = path(curve.earned);
    const actualPath = path(curve.actual);
    const areaPath = `${plannedPath} L${x(curve.planned.length - 1)},${margin.top + plotH} L${x(0)},${margin.top + plotH} Z`;
    const yTicks = Array.from({ length: 5 }, (_, index) => niceMax * index / 4);
    const labelCount = compact ? 5 : 7;
    const xTickIndexes = Array.from({ length: labelCount }, (_, index) => Math.round(index * (curve.dates.length - 1) / (labelCount - 1)));
    const gradientId = `plannedGradient-${containerId}`;
    const todaySampleIndex = nearestSampleIndex(curve.sampleIndexes, schedule.todayIndex);
    const todayLine = schedule.todayIndex >= 0 && schedule.todayIndex <= schedule.projectFinishIndex && todaySampleIndex >= 0
      ? `<line class="chart-today-line" x1="${x(todaySampleIndex)}" x2="${x(todaySampleIndex)}" y1="${margin.top}" y2="${margin.top + plotH}"></line><text class="chart-axis-text" x="${x(todaySampleIndex) + 5}" y="${margin.top + 11}">Today</text>`
      : "";
    const last = curve.dates.length - 1;
    const latestActualIndex = nearestSampleIndex(curve.sampleIndexes, Math.min(Math.max(schedule.todayIndex, 0), schedule.projectFinishIndex));

    host.innerHTML = `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Cumulative planned value, earned value and actual cost S-curve">
      <defs><linearGradient id="${gradientId}" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#2e75df" stop-opacity="0.18"></stop><stop offset="100%" stop-color="#2e75df" stop-opacity="0.01"></stop></linearGradient></defs>
      ${yTicks.map((tick) => `<line class="chart-grid-line" x1="${margin.left}" x2="${margin.left + plotW}" y1="${y(tick)}" y2="${y(tick)}"></line><text class="chart-axis-text" x="${margin.left - 10}" y="${y(tick) + 3}" text-anchor="end">${escapeHtml(formatAxisCurrency(tick))}</text>`).join("")}
      ${xTickIndexes.map((index) => `<text class="chart-axis-text" x="${x(index)}" y="${margin.top + plotH + (compact ? 22 : 30)}" text-anchor="middle">${escapeHtml(formatMonthDay(curve.dates[index]))}</text>`).join("")}
      <path d="${areaPath}" fill="url(#${gradientId})"></path>
      <path class="chart-line-planned" d="${plannedPath}"></path>
      <path class="chart-line-earned" d="${earnedPath}"></path>
      <path class="chart-line-actual" d="${actualPath}"></path>
      ${todayLine}
      <circle class="chart-dot" cx="${x(last)}" cy="${y(curve.planned[last])}" r="4" fill="#2e75df"></circle>
      ${latestActualIndex >= 0 ? `<circle class="chart-dot" cx="${x(latestActualIndex)}" cy="${y(curve.earned[latestActualIndex])}" r="4" fill="#2d9d68"></circle><circle class="chart-dot" cx="${x(latestActualIndex)}" cy="${y(curve.actual[latestActualIndex])}" r="4" fill="#e9892d"></circle>` : ""}
    </svg>
    <div class="chart-summary-badge">Finish plan ${formatCompactCurrency(curve.planned[last])}</div>`;
  }

  function buildSCurve(schedule) {
    const totalDays = Math.max(1, schedule.projectFinishIndex + 1, schedule.todayIndex + 1);
    const sampleStep = Math.max(1, Math.ceil(totalDays / 100));
    const sampleIndexes = [];
    for (let index = 0; index < totalDays; index += sampleStep) sampleIndexes.push(index);
    if (sampleIndexes[sampleIndexes.length - 1] !== totalDays - 1) sampleIndexes.push(totalDays - 1);
    const dates = sampleIndexes.map((index) => addDays(schedule.projectStart, index));
    const planned = [];
    const earned = [];
    const actual = [];

    sampleIndexes.forEach((dayIndex) => {
      let p = 0;
      let e = 0;
      let a = 0;
      schedule.rows.forEach((row) => {
        if (row.task.summary) return;
        const taskCost = Number(row.task.cost || 0);
        const progressValue = taskCost * Number(row.task.progress || 0) / 100;
        const actualValue = Number(row.task.actualCost || 0);
        p += taskCost * plannedFraction(row, dayIndex);
        const recorded = actualAt(row.task, addDays(schedule.projectStart,dayIndex));
        e += taskCost * recorded.progress / 100;
        a += recorded.cost;
      });
      planned.push(p);
      earned.push(e);
      actual.push(a);
    });
    return { dates, sampleIndexes, planned, earned, actual };
  }

  function actualFraction(row, dayIndex, todayIndex) {
    if (row.task.progress <= 0 || dayIndex < row.es) return 0;
    let earnedEnd;
    if (row.task.progress >= 100) earnedEnd = row.ef;
    else earnedEnd = Math.min(row.ef, Math.max(row.es, todayIndex));
    if (dayIndex >= earnedEnd) return 1;
    return clampNumber((dayIndex - row.es + 1) / Math.max(1, earnedEnd - row.es + 1), 0, 1, 0);
  }

  function normalizeActualHistory(records) {
    const dates = new Map();
    (Array.isArray(records) ? records : []).forEach(record => {
      if (isISODate(record.date)) dates.set(record.date, {date:record.date,progress:clampNumber(record.progress,0,100,0),cost:clampNumber(record.cost,0,Number.MAX_SAFE_INTEGER,0),note:String(record.note||"")});
    });
    return [...dates.values()].sort((a,b)=>a.date.localeCompare(b.date));
  }

  // Dated cumulative observations: hold the last known value; never fabricate earlier actuals.
  function actualAt(task, date) {
    const cutoff = toISO(date) < state.project.dataDate ? toISO(date) : state.project.dataDate;
    const history = normalizeActualHistory(task.actualHistory);
    if (history.length) {
      const record = history.filter(r=>r.date<=cutoff).at(-1);
      return record || {progress:0,cost:0};
    }
    return cutoff >= state.project.dataDate ? {progress:Number(task.progress||0),cost:Number(task.actualCost||0)} : {progress:0,cost:0};
  }

  function weeklyActualDialog(taskId) {
    const tasks=state.tasks.filter(t=>!t.summary), task=tasks.find(t=>t.id===taskId)||tasks[0];
    if(!task){showToast("เพิ่มกิจกรรมก่อนบันทึกผลงาน","error");return;}
    const records=normalizeActualHistory(task.actualHistory);
    pilotDialog("Actual รายสัปดาห์ / Progress log", `<p>กรอก <b>ผลงานสะสม (%) และค่าใช้จ่ายสะสม</b> ณ วันสิ้นงวด เลือกวันที่เดิมเพื่อแก้ย้อนหลัง เดือนรวมจากผลต่างรายสัปดาห์ตามเดือนของวันสิ้นงวด</p><label>กิจกรรม<select id="actual-log-task">${tasks.map(t=>`<option value="${escapeAttr(t.id)}" ${t.id===task.id?"selected":""}>${escapeHtml(t.id+" · "+t.name)}</option>`).join("")}</select></label><div class="actual-log-grid"><label>วันสิ้นงวด<input id="actual-log-date" type="date" value="${escapeAttr(state.project.dataDate)}" max="${escapeAttr(state.project.dataDate)}"></label><label>ผลงานสะสม %<input id="actual-log-progress" type="number" min="0" max="100" step="0.1" value="${task.progress}"></label><label>ค่าใช้จ่ายสะสม<input id="actual-log-cost" type="number" min="0" step="0.01" value="${task.actualCost}"></label></div><label>หมายเหตุ<input id="actual-log-note"></label><p id="actual-log-error" role="alert" class="bad"></p><button data-save-actual="${escapeAttr(task.id)}">บันทึกงวด</button><div class="table-scroll"><table class="data-table"><thead><tr><th>สิ้นงวด</th><th>สะสม %</th><th>ค่าใช้จ่ายสะสม</th><th>หมายเหตุ</th><th></th></tr></thead><tbody>${records.map(r=>`<tr><td>${escapeHtml(r.date)}</td><td>${r.progress}%</td><td>${formatCurrency(r.cost)}</td><td>${escapeHtml(r.note)}</td><td><button data-load-actual="${escapeAttr(r.date)}">แก้ไข</button><button data-delete-actual="${escapeAttr(r.date)}">ลบ</button></td></tr>`).join("")||'<tr><td colspan="5">ยังไม่มีประวัติ — ค่าเดิมจะแสดงเป็น snapshot ณ Data Date เท่านั้น ไม่กระจายย้อนหลัง</td></tr>'}</tbody></table></div><p class="pilot-note">เมื่อมีประวัติ กราฟใช้ค่าที่บันทึกตามวันที่ ไม่ใช้ % ปัจจุบันเพื่อแต่งประวัติย้อนหลัง เก็บอยู่ในเครื่องและรวมอยู่ใน Backup</p>`);
    document.getElementById("actual-log-task").addEventListener("change",e=>weeklyActualDialog(e.target.value));
    document.getElementById("actual-log-date").addEventListener("change",e=>{const previous=records.filter(r=>r.date<=e.target.value).at(-1);document.getElementById("actual-log-progress").value=previous?.progress||0;document.getElementById("actual-log-cost").value=previous?.cost||0;document.getElementById("actual-log-note").value=records.find(r=>r.date===e.target.value)?.note||"";});
  }

  function syncActualLog(task) {
    const record=normalizeActualHistory(task.actualHistory).filter(r=>r.date<=state.project.dataDate).at(-1);
    task.progress=record?.progress||0;task.actualCost=record?.cost||0;
    task.status=task.progress>=100?"done":task.progress>0?"in-progress":"backlog";
  }

  function initControl09() {
    document.addEventListener("click",e=>{
      if(e.target.closest("[data-weekly-actual]")){weeklyActualDialog();return;}
      const task=state.tasks.find(t=>t.id===document.getElementById("actual-log-task")?.value);
      const load=e.target.closest("[data-load-actual]");
      if(load&&task){const r=task.actualHistory.find(r=>r.date===load.dataset.loadActual);for(const [id,key] of [["date","date"],["progress","progress"],["cost","cost"],["note","note"]])document.getElementById(`actual-log-${id}`).value=r[key];return;}
      const remove=e.target.closest("[data-delete-actual]");
      if(remove&&task&&confirm("ลบงวดนี้? สำรองหรือ Undo เพื่อกู้คืนได้")){task.actualHistory=task.actualHistory.filter(r=>r.date!==remove.dataset.deleteActual);syncActualLog(task);saveState(true);renderAll();weeklyActualDialog(task.id);return;}
      if(e.target.closest("[data-save-actual]")&&task){
        const date=document.getElementById("actual-log-date").value,progress=Number(document.getElementById("actual-log-progress").value),cost=Number(document.getElementById("actual-log-cost").value),error=document.getElementById("actual-log-error");
        if(!isISODate(date)||date>state.project.dataDate||!Number.isFinite(progress)||progress<0||progress>100||!Number.isFinite(cost)||cost<0){error.textContent="ตรวจวันที่ (ไม่เกิน Data Date), % 0–100 และค่าใช้จ่ายไม่ติดลบ";return;}
        const record={date,progress,cost,note:document.getElementById("actual-log-note").value.trim()};
        const records=normalizeActualHistory([...task.actualHistory.filter(r=>r.date!==date),record]);
        if(records.some((r,i)=>i>0&&(r.progress<records[i-1].progress||r.cost<records[i-1].cost))){error.textContent="ยอดสะสมต้องไม่ลดลงจากงวดก่อน และไม่เกินงวดถัดไป กรุณาแก้ประวัติที่เกี่ยวข้องด้วย";return;}
        task.actualHistory=records;syncActualLog(task);saveState(true);renderAll();weeklyActualDialog(task.id);showToast("บันทึกประวัติ Actual แล้ว","success");
      }
      if(e.target.closest("[data-confirm-xml]")&&pendingXmlImport){
        const calendar=document.getElementById("xml-calendar").value;
        if(!document.getElementById("xml-ack").checked){document.getElementById("xml-error").textContent="ยืนยันข้อจำกัดและสำรองข้อมูลก่อนนำเข้า";return;}
        const backup={...state,exportedAt:new Date().toISOString()};downloadBlob(JSON.stringify(backup,null,2),`${slugify(state.project.name)}-before-xml.json`,"application/json");
        state=normalizeState(pendingXmlImport);state.project.calendar=calendar;pendingXmlImport=null;saveState(true);renderAll();setView("schedule",false);document.getElementById("pilot-dialog").close();showToast("นำเข้าแล้ว พร้อมสำรองโครงการเดิม","success");
      }
    });
  }

  function renderCostByStatus() {
    const totals = Object.fromEntries(STATUS_ORDER.map((status) => [status, 0]));
    state.tasks.forEach((task) => totals[task.status] += Number(task.cost || 0));
    const max = Math.max(1, ...Object.values(totals));
    document.getElementById("cost-by-status").innerHTML = STATUS_ORDER.map((status) => `<div class="cost-bar-row">
      <label>${STATUS_META[status].label}</label>
      <div class="cost-bar-track"><div class="cost-bar-fill status-${status}" style="width:${totals[status] / max * 100}%"></div></div>
      <strong>${formatCompactCurrency(totals[status])}</strong>
    </div>`).join("");
  }

  function renderEvmExplainer(metrics, eac, vac) {
    const rows = [
      { name: "CPI — cost performance", note: "Earned value ÷ actual cost", value: metrics.cpi ? metrics.cpi.toFixed(2) : "—", className: performanceClass(metrics.cpi) },
      { name: "SPI — schedule performance", note: "Earned value ÷ planned value", value: metrics.spi ? metrics.spi.toFixed(2) : "—", className: performanceClass(metrics.spi) },
      { name: "Cost variance", note: "Earned value − actual cost", value: formatCompactCurrency(metrics.costVariance), className: metrics.costVariance >= 0 ? "good" : "bad" },
      { name: "Schedule variance", note: "Earned value − planned value", value: formatCompactCurrency(metrics.scheduleVariance), className: metrics.scheduleVariance >= 0 ? "good" : "bad" },
      { name: "Forecast variance", note: "Approved budget − estimate at completion", value: formatCompactCurrency(vac), className: vac >= 0 ? "good" : "bad" }
    ];
    document.getElementById("evm-explainer").innerHTML = rows.map((row) => `<div class="metric-row"><div><strong>${escapeHtml(row.name)}</strong><small>${escapeHtml(row.note)}</small></div><span class="metric-value ${row.className}">${escapeHtml(row.value)}</span></div>`).join("");
  }

  function renderCostTable(schedule) {
    document.getElementById("cost-table-body").innerHTML = schedule.rows.map((row) => {
      const earnedBudget = Number(row.task.cost || 0) * Number(row.task.progress || 0) / 100;
      const variance = earnedBudget - Number(row.task.actualCost || 0);
      let status = "neutral";
      let label = "No actuals";
      if (row.task.actualCost > 0) {
        if (variance >= 0) { status = "good"; label = "Favorable"; }
        else if (Math.abs(variance) <= Math.max(1000, earnedBudget * 0.05)) { status = "warn"; label = "Near plan"; }
        else { status = "bad"; label = "Unfavorable"; }
      }
      return `<tr>
        <td><span class="id-pill">${escapeHtml(row.task.id)}</span></td>
        <td class="task-cell"><strong>${escapeHtml(row.task.name)}</strong><small>Earned budget ${formatCompactCurrency(earnedBudget)}</small></td>
        <td class="numeric">${formatCurrency(row.task.cost)}</td>
        <td class="numeric">${formatCurrency(row.task.actualCost)}</td>
        <td class="numeric"><span class="delta ${variance >= 0 ? "good" : "bad"}">${formatSignedCurrency(variance)}</span></td>
        <td>${row.task.progress}%</td>
        <td><span class="cost-status-pill ${status}">${label}</span></td>
      </tr>`;
    }).join("");
  }

  function defaultManpower(owner) {
    const key = String(owner || "").toLowerCase();
    if (key.includes("civil")) return 18;
    if (key.includes("struct")) return 26;
    if (key.includes("construction")) return 22;
    if (key.includes("mep")) return 14;
    if (key.includes("design")) return 8;
    if (key.includes("qa")) return 6;
    if (key.includes("procure")) return 5;
    if (key.includes("permit")) return 3;
    if (key.includes("pmo")) return 4;
    return 8;
  }

  function manpowerFor(task) {
    return task?.manpower != null && Number.isFinite(Number(task.manpower)) && Number(task.manpower) >= 0 ? Number(task.manpower) : defaultManpower(task?.owner);
  }

  function resourceSeries(schedule) {
    const teams = [...new Set(schedule.rows.map((row) => row.task.resourceTeam || row.task.owner || "General crew"))].sort();
    const days = Array.from({ length: Math.max(1, schedule.projectFinishIndex + 1) }, (_, day) => {
      const byTeam = Object.fromEntries(teams.map((team) => [team, 0]));
      schedule.rows.forEach((row) => {
        if (!row.task.summary && !row.task.milestone && day >= row.es && day <= row.ef && isProjectWorkday(addDays(schedule.projectStart,day))) byTeam[row.task.resourceTeam || row.task.owner || "General crew"] += manpowerFor(row.task);
      });
      return { day, byTeam, total: Object.values(byTeam).reduce((a, b) => a + b, 0) };
    });
    return { teams, days };
  }

  function renderResources(schedule) {
    let controls=document.getElementById("resource-controls");
    if(!controls){controls=document.createElement("div");controls.id="resource-controls";controls.className="control09-toolbar";controls.innerHTML=`<label>ตั้งแต่<input id="resource-from" type="date"></label><label>ถึง<input id="resource-to" type="date"></label><label>ทีม<select id="resource-team"></select></label><button id="resource-clear">แสดงทั้งโครงการ</button>`;document.getElementById("resource-kpis").before(controls);}
    const selected=document.getElementById("resource-team").value||"all";
    const teamNames=[...new Set(schedule.rows.filter(r=>!r.task.summary).map(r=>r.task.resourceTeam||r.task.owner||"General crew"))];
    document.getElementById("resource-team").innerHTML=`<option value="all">ทุกทีม</option>${teamNames.map(t=>`<option value="${escapeAttr(t)}" ${t===selected?"selected":""}>${escapeHtml(t)}</option>`).join("")}`;
    const from=document.getElementById("resource-from").value,to=document.getElementById("resource-to").value;
    const filtered={...schedule,rows:schedule.rows.filter(r=>!r.task.summary&&(selected==="all"||(r.task.resourceTeam||r.task.owner||"General crew")===selected))};
    const raw=resourceSeries(filtered),series={...raw,days:raw.days.filter(d=>{const date=toISO(addDays(schedule.projectStart,d.day));return (!from||date>=from)&&(!to||date<=to);})};
    for(const id of ["resource-from","resource-to","resource-team"])document.getElementById(id).onchange=()=>renderResources(currentSchedule);
    document.getElementById("resource-clear").onclick=()=>{document.getElementById("resource-from").value="";document.getElementById("resource-to").value="";document.getElementById("resource-team").value="all";renderResources(currentSchedule);};
    const capacity = Number(state.project.resourceCapacity || 70);
    const peak = Math.max(0, ...series.days.map((day) => day.total));
    const overloadDays = series.days.filter((day) => day.total > capacity).length;
    const personDays = series.days.reduce((sum,day)=>sum+day.total,0);
    document.getElementById("resource-kpis").innerHTML = [
      kpiCard({ label: "Peak manpower", value: `${peak} people`, icon: "↑", iconClass: peak > capacity ? "red" : "green", metaLeft: `Capacity ${capacity}/day`, metaClass: peak > capacity ? "bad" : "good", metaRight: `${overloadDays} overload days` }),
      kpiCard({ label: "Total person-days", value: personDays.toLocaleString(), icon: "Σ", iconClass: "blue", metaLeft: `${series.teams.length} resource teams`, metaRight: `${schedule.rows.length} activities` }),
      kpiCard({ label: "Average loading", value: `${round1(series.days.reduce((s,d)=>s+d.total,0)/Math.max(1,series.days.length))}/day`, icon: "≈", iconClass: "purple", metaLeft: `${round1(peak ? capacity/peak*100 : 0)}% capacity/peak`, metaRight: formatDate(state.project.dataDate ? fromISO(state.project.dataDate) : new Date()) }),
      kpiCard({ label: "Capacity status", value: overloadDays ? "Overallocated" : "Within limit", icon: "!", iconClass: overloadDays ? "red" : "green", metaLeft: overloadDays ? "Level or resequence crews" : "No daily overload", metaClass: overloadDays ? "bad" : "good", metaRight: `${overloadDays} days` })
    ].join("");
    const colors = ["#2f6fb3","#3c9a61","#c77531","#8b6bbd","#c4a036","#5c7d8f","#d65c5c","#46a3a3"];
    document.getElementById("resource-legend").innerHTML = series.teams.map((team,i)=>`<span><i class="resource-key" style="background:${colors[i%colors.length]}"></i>${escapeHtml(team)}</span>`).join("") + `<span><i class="capacity-key"></i>Capacity ${capacity}</span>`;
    const width=1100,height=360,left=48,right=20,top=18,bottom=45,plotW=width-left-right,plotH=height-top-bottom,maxY=Math.max(capacity,peak,1)*1.15;
    const barW=Math.max(.25,plotW/Math.max(1,series.days.length)-1), x=(i)=>left+i*plotW/Math.max(1,series.days.length), y=(v)=>top+plotH-v/maxY*plotH;
    const bars=series.days.map((day,i)=>{let cumulative=0;return series.teams.map((team,t)=>{const value=day.byTeam[team];const yTop=y(cumulative+value),h=y(cumulative)-yTop;cumulative+=value;return value?`<rect x="${x(i)}" y="${yTop}" width="${barW}" height="${Math.max(.5,h)}" fill="${colors[t%colors.length]}"><title>${escapeHtml(formatDate(addDays(schedule.projectStart,day.day),true))} · ${escapeHtml(team)} ${value} people · total ${day.total}</title></rect>`:"";}).join("");}).join("");
    const tickStep=Math.max(1,Math.ceil(series.days.length/12));
    document.getElementById("resource-histogram").innerHTML=`<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Stacked daily resource histogram"><line class="capacity-line" x1="${left}" x2="${width-right}" y1="${y(capacity)}" y2="${y(capacity)}"></line><text class="capacity-label" x="${width-right}" y="${y(capacity)-6}" text-anchor="end">Capacity ${capacity}</text>${bars}${series.days.map((d,i)=>i%tickStep===0?`<text class="chart-axis-text" x="${x(i)}" y="${height-15}" text-anchor="middle">${escapeHtml(formatDate(addDays(schedule.projectStart,d.day)))}</text>`:"").join("")}</svg>${!series.days.length?"<p>ไม่พบข้อมูลในช่วงที่เลือก</p>":""}<p class="pilot-note">${selected==="all"?"ทุกทีม":"ทีมที่เลือก"} · Capacity เป็นกำลังคนรวมโครงการ · แสดง loading ตามแผน ไม่ใช่ Resource Leveling อัตโนมัติ</p>`;
    document.getElementById("resource-table-body").innerHTML=filtered.rows.filter(r=>(!from||toISO(r.endDate)>=from)&&(!to||toISO(r.startDate)<=to)).map((row)=>{const manpower=row.task.milestone?0:manpowerFor(row.task),days=series.days.filter(d=>d.day>=row.es&&d.day<=row.ef&&isProjectWorkday(addDays(schedule.projectStart,d.day))).length,pd=manpower*days;const overloaded=manpower>0&&series.days.some(d=>d.day>=row.es&&d.day<=row.ef&&d.total>capacity);const status=overloaded?"Concurrent overload":"Normal";return `<tr data-edit-task="${escapeAttr(row.task.id)}"><td><span class="id-pill">${escapeHtml(row.task.id)}</span></td><td class="task-cell"><strong>${escapeHtml(row.task.name)}</strong><small>${escapeHtml(row.task.wbs||"General")}</small></td><td>${escapeHtml(row.task.resourceTeam||row.task.owner)}</td><td class="numeric">${manpower}</td><td class="numeric">${row.task.milestone?0:days}d</td><td class="numeric"><strong>${pd.toLocaleString()}</strong></td><td>${formatDate(row.startDate)}</td><td>${formatDate(row.endDate)}</td><td><span class="load-pill ${overloaded?'bad':'good'}">${status}</span></td></tr>`;}).join("");
    let overload=document.getElementById("resource-overload-register");if(!overload){overload=document.createElement("section");overload.id="resource-overload-register";overload.className="panel table-scroll";document.getElementById("resource-histogram").closest(".panel").after(overload);}
    overload.innerHTML=`<h3>วันที่กำลังคนเกิน Capacity · ${overloadDays} วัน</h3><p>ตรวจทีมและกิจกรรมที่ทำพร้อมกันก่อนปรับลำดับงาน</p><table class="data-table"><thead><tr><th>วันที่</th><th>คน / เกิน</th><th>กิจกรรมร่วมวันนั้น</th></tr></thead><tbody>${series.days.filter(d=>d.total>capacity).map(d=>`<tr><td>${formatDate(addDays(schedule.projectStart,d.day),true)}</td><td>${d.total} / +${d.total-capacity}</td><td>${filtered.rows.filter(r=>!r.task.milestone&&d.day>=r.es&&d.day<=r.ef).map(r=>`<button data-edit-task="${escapeAttr(r.task.id)}">${escapeHtml(r.task.id)} · ${manpowerFor(r.task)}</button>`).join(" ")}</td></tr>`).join("")||'<tr><td colspan="3">ไม่มีวันที่เกินกำลังในตัวกรองนี้</td></tr>'}</tbody></table>`;
  }

  function renderLookahead(schedule) {
    const dataDate = state.project.dataDate ? fromISO(state.project.dataDate) : startOfDay(new Date());
    const weeks = Array.from({length:3},(_,i)=>({start:addDays(dataDate,i*7),end:addDays(dataDate,i*7+6),label:i===0?"This week":`In ${i} week${i>1?"s":""}`}));
    const owner = document.getElementById("lookahead-owner")?.value || "all";
    const mode = document.getElementById("lookahead-mode")?.value || "all";
    const eligible=row=>!row.task.summary && row.task.progress<100 && (owner==="all"||row.task.owner===owner) && (mode!=="critical"||row.critical) && (mode!=="blocked"||readinessFor(row,schedule).length>0);
    const byWeek = weeks.map((week,i)=>schedule.rows.filter((row)=>eligible(row)&&row.startDate<=week.end&&(row.endDate>=week.start||i===0&&row.endDate<dataDate)));
    const unique = new Set(byWeek.flat().map((row)=>row.task.id));
    const critical = [...unique].filter((id)=>schedule.byId.get(id.toUpperCase())?.critical).length;
    const resources=resourceSeries(schedule);
    const peak = Math.max(0,...resources.days.filter(d=>{const date=addDays(schedule.projectStart,d.day);return date>=dataDate&&date<=weeks[2].end;}).map(d=>d.total));
    let controls=document.getElementById("lookahead-controls");
    if(!controls){controls=document.createElement("div");controls.id="lookahead-controls";controls.className="control09-toolbar";document.getElementById("lookahead-summary").before(controls);}
    controls.innerHTML=`<label>ผู้รับผิดชอบ<select id="lookahead-owner"><option value="all">ทุกคน</option>${[...new Set(state.tasks.map(t=>t.owner))].map(o=>`<option ${o===owner?"selected":""} value="${escapeAttr(o)}">${escapeHtml(o)}</option>`).join("")}</select></label><label>แสดง<select id="lookahead-mode"><option value="all">ทั้งหมด</option><option value="critical">Critical</option><option value="blocked">มีข้อจำกัด / ไม่พร้อม</option></select></label><button id="lookahead-report-print">พิมพ์รายงานประชุม</button>`;
    document.getElementById("lookahead-mode").value=mode;
    for(const id of ["lookahead-owner","lookahead-mode"])document.getElementById(id).onchange=()=>renderLookahead(currentSchedule);
    document.getElementById("lookahead-report-print").onclick=()=>printView("lookahead");
    document.getElementById("lookahead-subtitle").textContent=`From Data Date ${formatDate(dataDate,true)} · for weekly site coordination`;
document.getElementById("lookahead-summary").innerHTML=[kpiCard({label:"Activities",value:String(unique.size),icon:"▦",iconClass:"blue",metaLeft:"Across 21 days",metaRight:`${critical} critical`}),kpiCard({label:"Critical work",value:String(critical),icon:"!",iconClass:critical?"red":"green",metaLeft:"Zero total float",metaClass:critical?"bad":"good",metaRight:"Prioritize constraints"}),kpiCard({label:"Peak daily crews (21d)",value:`${peak} people`,icon:"↑",iconClass:peak>state.project.resourceCapacity?"red":"green",metaLeft:`Capacity ${state.project.resourceCapacity}/day`,metaRight:peak>state.project.resourceCapacity?"Review loading":"Within limit"})].join("");
    document.getElementById("lookahead-board").innerHTML=weeks.map((week,i)=>`<section class="lookahead-column"><header><div><span>${week.label}</span><small>${formatDate(week.start)} – ${formatDate(week.end)}</small></div><strong>${byWeek[i].length}</strong></header><div class="lookahead-cards">${byWeek[i].length?byWeek[i].map((row)=>{const status=row.endDate<dataDate?"งานค้าง / Overdue":row.critical?"Critical":row.slack<=5?"Near-critical":row.startDate<week.start?"Continuing":"Starting";const gates=readinessFor(row,schedule);return `<article class="lookahead-card ${row.critical?"critical":row.slack<=5?"near":""}" data-edit-task="${escapeAttr(row.task.id)}"><div class="lookahead-card-top"><span>${escapeHtml(row.task.id)}</span><b>${status}</b></div><h4>${escapeHtml(row.task.name)}</h4><p>${escapeHtml(row.task.wbs||"General")}</p><p class="${gates.length?'bad':'good'}">${gates.length?escapeHtml(gates.join(" · ")):"พร้อมตามข้อมูลที่บันทึก"}</p>${row.task.constraint?`<p>แก้โดย ${escapeHtml(row.task.constraintOwner||row.task.owner)} · ${escapeHtml(row.task.constraintDue||"ไม่ระบุกำหนด")}</p>`:""}<div class="lookahead-progress"><span style="width:${row.task.progress}%"></span></div><div class="lookahead-meta"><span>${escapeHtml(row.task.owner)} · ${manpowerFor(row.task)} people</span><strong>${row.task.progress}%</strong></div><small>${formatDate(row.startDate)} – ${formatDate(row.endDate)} · TF ${row.slack}d</small></article>`;}).join(""):`<div class="empty-state">No active work</div>`}</div></section>`).join("");
    let report=document.getElementById("lookahead-report");if(!report){report=document.createElement("section");report.id="lookahead-report";report.className="panel table-scroll";document.getElementById("lookahead-board").after(report);}
    report.innerHTML=`<h3>รายงานประสานงาน 3 สัปดาห์ · ${formatDate(dataDate,true)}</h3><p>Peak เป็นกำลังคนรายวันของแผนทั้งโครงการ ไม่ใช่ผลรวมทุกงานในสัปดาห์ งานค้างยังไม่ถูกเพิ่มกำลังคนใน Histogram จนกว่าจะปรับ Forecast/แผน</p><table class="data-table"><thead><tr><th>ID / งาน</th><th>ผู้รับผิดชอบ</th><th>เริ่ม–จบ</th><th>% / TF</th><th>ข้อจำกัด / เงื่อนไข</th><th>ผู้แก้ / กำหนด</th></tr></thead><tbody>${[...new Map(byWeek.flat().map(r=>[r.task.id,r])).values()].map(r=>`<tr><td>${escapeHtml(r.task.id+" · "+r.task.name)}</td><td>${escapeHtml(r.task.owner)}</td><td>${formatDate(r.startDate)} – ${formatDate(r.endDate)}</td><td>${r.task.progress}% / ${r.slack}d</td><td>${escapeHtml(readinessFor(r,schedule).join(" · ")||"พร้อมตามข้อมูล")}</td><td>${escapeHtml(r.task.constraintOwner)} / ${escapeHtml(r.task.constraintDue)}</td></tr>`).join("")}</tbody></table>`;
  }

  function readinessFor(row,schedule) {
    const gates=[];
    if(!row.task.ready)gates.push("ยังไม่พร้อม");
    if(row.task.constraint)gates.push(row.task.constraint);
    for(const p of row.predecessors||[]){const pred=schedule.byId.get(p.id);if(!pred)continue;
      const started=pred.task.actualStart||pred.task.progress>0,finished=pred.task.progress>=100||pred.task.actualFinish;
      if((p.type==="FS"||p.type==="FF")&&!finished)gates.push(`${p.id}${p.type}: ยังไม่จบ${p.type==="FF"?" (เงื่อนไขจบงาน)":""}`);
      if((p.type==="SS"||p.type==="SF")&&!started)gates.push(`${p.id}${p.type}: ยังไม่เริ่ม${p.type==="SF"?" (เงื่อนไขจบงาน)":""}`);
      if(p.lag)gates.push(`${p.id}${p.type}${p.lag>0?"+":""}${p.lag}: ตรวจ Lag/Lead กับวันที่แผน/Forecast`);
    }
    return gates;
  }

  function renderSettings() {
    document.getElementById("settings-project-name").value = state.project.name;
    document.getElementById("settings-project-start").value = state.project.startDate;
    document.getElementById("settings-currency").value = state.project.currency;
    document.getElementById("settings-budget").value = state.project.budget;
    document.getElementById("settings-data-date").value = state.project.dataDate;
    document.getElementById("settings-resource-capacity").value = state.project.resourceCapacity;
    document.getElementById("settings-calendar").value = state.project.calendar;
    document.getElementById("settings-holidays").value = (state.project.holidays || []).join(", ");
    document.getElementById("settings-forecast").checked = Boolean(state.project.forecast);
    document.getElementById("settings-note").value = state.project.note || "";
  }

  function openTaskModal(taskId = null) {
    const task = taskId ? state.tasks.find((item) => item.id.toUpperCase() === taskId.toUpperCase()) : null;
    document.getElementById("task-modal-title").textContent = task ? "Edit task" : "Add task";
    document.getElementById("task-edit-original-id").value = task?.id || "";
    document.getElementById("task-id").value = task?.id || nextTaskId();
    document.getElementById("task-name").value = task?.name || "";
    document.getElementById("task-owner").value = task?.owner || "";
    document.getElementById("task-wbs").value = task?.wbs || "General";
    document.getElementById("task-resource-team").value = task?.resourceTeam || task?.owner || "";
    document.getElementById("task-manpower").value = task ? manpowerFor(task) : 0;
    document.getElementById("task-duration").value = task?.duration ?? 5;
    document.getElementById("task-milestone").checked = Boolean(task?.milestone);
    document.getElementById("task-remaining").value = task?.remainingDuration ?? "";
    document.getElementById("task-planned-start").value = task?.plannedStart || "";
    document.getElementById("task-planned-finish").value = task?.plannedFinish || "";
    document.getElementById("task-actual-start").value = task?.actualStart || "";
    document.getElementById("task-actual-finish").value = task?.actualFinish || "";
    document.getElementById("task-predecessor").value = task?.predecessor || "";
    document.getElementById("task-cost").value = task?.cost ?? 0;
    document.getElementById("task-actual-cost").value = task?.actualCost ?? 0;
    document.getElementById("task-actual-cost").disabled=Boolean(task?.actualHistory?.length);
    document.getElementById("task-progress").disabled=Boolean(task?.actualHistory?.length);
    document.getElementById("task-progress").value = task?.progress ?? 0;
    document.getElementById("task-status").value = task?.status || "backlog";
    document.getElementById("task-notes").value = task?.notes || "";
    let logNote=document.getElementById("task-log-note");if(!logNote){logNote=document.createElement("p");logNote.id="task-log-note";logNote.className="pilot-note";document.getElementById("task-notes").closest("label").after(logNote);}
    logNote.textContent=task?.actualHistory?.length?"กิจกรรมนี้มีประวัติ Actual: แก้ % / ค่าใช้จ่ายผ่านปุ่ม Actual รายสัปดาห์ เพื่อให้กราฟและรายงานตรงกัน":"ค่า % และค่าใช้จ่ายที่กรอกจะแสดงเป็น snapshot ณ Data Date; ใช้ Actual รายสัปดาห์เพื่อบันทึกย้อนหลัง";
    document.getElementById("task-constraint").value = task?.constraint || "";
    document.getElementById("task-constraint-owner").value = task?.constraintOwner || task?.owner || "";
    document.getElementById("task-constraint-due").value = task?.constraintDue || "";
    document.getElementById("task-ready").checked = task?.ready !== false;
    document.getElementById("task-form-error").textContent = "";
    document.getElementById("delete-task-button").hidden = !task;
    document.getElementById("modal-backdrop").hidden = false;
    document.body.style.overflow = "hidden";
    setTimeout(() => document.getElementById(task ? "task-name" : "task-id").focus(), 40);
  }

  function closeTaskModal() {
    document.getElementById("modal-backdrop").hidden = true;
    document.body.style.overflow = "";
  }

  function handleTaskSubmit(event) {
    event.preventDefault();
    const originalId = document.getElementById("task-edit-original-id").value.trim().toUpperCase();
    const id = document.getElementById("task-id").value.trim().toUpperCase();
    const name = document.getElementById("task-name").value.trim();
    const predecessor = document.getElementById("task-predecessor").value.trim().toUpperCase();
    const errorHost = document.getElementById("task-form-error");

    if (!/^[A-Z0-9_-]+$/.test(id)) {
      errorHost.textContent = "Task ID may contain letters, numbers, underscore and hyphen only.";
      return;
    }
    if (!name) {
      errorHost.textContent = "Task name is required.";
      return;
    }
    if (state.tasks.some((task) => task.id.toUpperCase() === id && task.id.toUpperCase() !== originalId)) {
      errorHost.textContent = `Task ID ${id} already exists.`;
      return;
    }
    const parsedPredecessors = parsePredecessors(predecessor);
    const invalidPredecessor = parsedPredecessors.find((pred) => pred.invalid);
    if (invalidPredecessor) {
      errorHost.textContent = `Invalid dependency “${invalidPredecessor.raw}”. Use ID + FS/FF/SS/SF + optional lag, e.g. T100FS+2.`;
      return;
    }
    if (parsedPredecessors.some((pred) => pred.id === id)) {
      errorHost.textContent = "A task cannot list itself as a predecessor.";
      return;
    }
    const plannedStart = document.getElementById("task-planned-start").value;
    const plannedFinish = document.getElementById("task-planned-finish").value;
    const actualStart = document.getElementById("task-actual-start").value;
    const actualFinish = document.getElementById("task-actual-finish").value;
    if (actualFinish && (!actualStart || actualFinish < actualStart)) { errorHost.textContent = "Actual Finish ต้องมี Actual Start และไม่ก่อนวันเริ่มจริง"; return; }
    if (plannedStart && plannedFinish && fromISO(plannedFinish) < fromISO(plannedStart)) {
      errorHost.textContent = "Planned finish must be on or after planned start.";
      return;
    }

    let progress = clampNumber(document.getElementById("task-progress").value, 0, 100, 0);
    let status = document.getElementById("task-status").value;
    if (status === "done") progress = 100;
    if (progress === 100) status = "done";

    const task = {
      id,
      name,
      owner: document.getElementById("task-owner").value.trim() || "Unassigned",
      wbs: document.getElementById("task-wbs").value.trim() || "General",
      resourceTeam: document.getElementById("task-resource-team").value.trim() || document.getElementById("task-owner").value.trim() || "General crew",
      manpower: clampNumber(document.getElementById("task-manpower").value, 0, 9999, 0),
      duration: document.getElementById("task-milestone").checked ? 0 : clampNumber(document.getElementById("task-duration").value, 0, 999, 1),
      milestone: document.getElementById("task-milestone").checked || Number(document.getElementById("task-duration").value)===0,
      remainingDuration: document.getElementById("task-remaining").value === "" ? null : clampNumber(document.getElementById("task-remaining").value,0,999,0),
      plannedStart,
      plannedFinish,
      actualStart,
      actualFinish,
      actualHistory: originalId ? state.tasks.find(item=>item.id.toUpperCase()===originalId)?.actualHistory || [] : [],
      constraint: document.getElementById("task-constraint").value.trim(),
      constraintOwner: document.getElementById("task-constraint-owner").value.trim(),
      constraintDue: document.getElementById("task-constraint-due").value,
      ready: document.getElementById("task-ready").checked,
      outlineLevel: originalId ? state.tasks.find(item => item.id.toUpperCase() === originalId)?.outlineLevel || 1 : 1,
      summary: originalId ? Boolean(state.tasks.find(item => item.id.toUpperCase() === originalId)?.summary) : false,
      predecessor,
      cost: clampNumber(document.getElementById("task-cost").value, 0, Number.MAX_SAFE_INTEGER, 0),
      actualCost: clampNumber(document.getElementById("task-actual-cost").value, 0, Number.MAX_SAFE_INTEGER, 0),
      progress,
      status,
      notes: document.getElementById("task-notes").value.trim(),
      baselineStart: originalId ? state.tasks.find((item) => item.id.toUpperCase() === originalId)?.baselineStart || "" : "",
      baselineFinish: originalId ? state.tasks.find((item) => item.id.toUpperCase() === originalId)?.baselineFinish || "" : "",
      baselineCost: originalId ? state.tasks.find((item) => item.id.toUpperCase() === originalId)?.baselineCost || 0 : 0
    };
    if(task.actualHistory.length)syncActualLog(task);

    if (originalId) {
      const index = state.tasks.findIndex((item) => item.id.toUpperCase() === originalId);
      if (index >= 0) state.tasks[index] = task;
      if (originalId !== id) {
        state.tasks.forEach((item) => {
          if (item.id !== id) item.predecessor = replacePredecessorId(item.predecessor, originalId, id);
        });
      }
      showToast(`${id} updated.`, "success");
    } else {
      state.tasks.push(task);
      showToast(`${id} added to the schedule.`, "success");
    }

    closeTaskModal();
    saveState();
    renderAll();
  }

  function setBaseline() {
    const schedule = currentSchedule || buildSchedule();
    const hasBaseline = state.tasks.some((task) => task.baselineStart && task.baselineFinish);
    if (hasBaseline && !window.confirm("Replace the current baseline with the latest schedule and budget?")) return;
    schedule.rows.forEach((row) => {
      row.task.baselineStart = toISO(row.startDate);
      row.task.baselineFinish = toISO(row.endDate);
      row.task.baselineCost = Number(row.task.cost || 0);
    });
    state.project.baselineSavedAt = new Date().toISOString();
    saveState(true);
    renderAll();
    showToast("Baseline saved from the current schedule and budget.", "success");
  }

  function deleteTaskFromModal() {
    const originalId = document.getElementById("task-edit-original-id").value.trim().toUpperCase();
    if (!originalId) return;
    const task = state.tasks.find((item) => item.id.toUpperCase() === originalId);
    if (!task) return;
    if (!window.confirm(`Delete ${task.id} — ${task.name}? Successor predecessor fields will be cleaned.`)) return;
    state.tasks = state.tasks.filter((item) => item.id.toUpperCase() !== originalId);
    state.tasks.forEach((item) => item.predecessor = removePredecessorId(item.predecessor, originalId));
    closeTaskModal();
    saveState();
    renderAll();
    showToast(`${originalId} deleted.`, "success");
  }

  function replacePredecessorId(value, oldId, newId) {
    return String(value || "").split(",").map((token) => {
      const trimmed = token.trim();
      const match = trimmed.toUpperCase().match(/^([A-Z0-9_-]+)(.*)$/);
      return match && match[1] === oldId ? `${newId}${match[2]}` : trimmed;
    }).filter(Boolean).join(",");
  }

  function removePredecessorId(value, id) {
    return String(value || "").split(",").map((token) => token.trim()).filter((token) => {
      const match = token.toUpperCase().match(/^([A-Z0-9_-]+)/);
      return match && match[1] !== id;
    }).join(",");
  }

  function updateTaskProgress(taskId, progress) {
    const task = state.tasks.find((item) => item.id.toUpperCase() === taskId.toUpperCase());
    if (!task) return;
    if(task.actualHistory?.length){weeklyActualDialog(task.id);return;}
    task.progress = clampNumber(progress, 0, 100, 0);
    if (task.progress === 100) task.status = "done";
    else if (task.status === "done") task.status = task.progress >= 80 ? "review" : "in-progress";
    saveState();
    renderAll();
  }

  function moveTaskToStatus(taskId, status) {
    if (!STATUS_ORDER.includes(status)) return;
    const task = state.tasks.find((item) => item.id.toUpperCase() === taskId.toUpperCase());
    if (!task || task.status === status) return;
    if(task.actualHistory?.length){weeklyActualDialog(task.id);return;}
    task.status = status;
    if (status === "done") task.progress = 100;
    else if (task.progress === 100) task.progress = status === "review" ? 90 : 75;
    saveState();
    renderAll();
    showToast(`${task.id} moved to ${STATUS_META[status].label}.`, "success");
  }

  function handleProjectSettings(event) {
    event.preventDefault();
    const holidayInput=document.getElementById("settings-holidays").value.split(/[\s,;]+/).filter(Boolean);
    if(holidayInput.some(d=>!isISODate(d))){showToast("วันหยุดใช้วันที่จริงรูปแบบ YYYY-MM-DD","error");return;}
    state.project.name = document.getElementById("settings-project-name").value.trim() || "Untitled project";
    state.project.startDate = document.getElementById("settings-project-start").value;
    state.project.currency = document.getElementById("settings-currency").value;
    state.project.budget = clampNumber(document.getElementById("settings-budget").value, 0, Number.MAX_SAFE_INTEGER, 0);
    state.project.dataDate = document.getElementById("settings-data-date").value;
    state.project.resourceCapacity = clampNumber(document.getElementById("settings-resource-capacity").value, 1, 999999, 70);
    const holidays = document.getElementById("settings-holidays").value.split(/[\s,;]+/).filter(Boolean);
    if (holidays.some(d=>!isISODate(d))) { showToast("วันหยุดใช้รูปแบบ YYYY-MM-DD คั่นด้วยจุลภาค","error"); return; }
    state.project.calendar = document.getElementById("settings-calendar").value;
    state.project.holidays = [...new Set(holidays)];
    state.project.forecast = document.getElementById("settings-forecast").checked;
    state.project.note = document.getElementById("settings-note").value.trim();
    state.tasks.filter(t=>t.actualHistory?.length).forEach(syncActualLog);
    saveState();
    renderAll();
    showToast("Project settings updated.", "success");
  }

  function exportProjectJson() {
    const payload = { ...state, exportedAt: new Date().toISOString(), application: "GO Project Planner" };
    downloadBlob(JSON.stringify(payload, null, 2), `${slugify(state.project.name)}-backup.json`, "application/json");
    showToast("Project backup downloaded.", "success");
  }

  function importProjectJson(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result));
        state = normalizeState(parsed);
        saveState(true);
        renderAll();
        setView(state.ui.activeView || "dashboard", false);
        showToast("Project backup imported.", "success");
      } catch (error) {
        console.error(error);
        showToast("The selected JSON file is not a valid GO Planner backup.", "error");
      } finally {
        event.target.value = "";
      }
    };
    reader.readAsText(file);
  }

  function importMicrosoftProjectXml(event, onPreview = null) {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const xml = new DOMParser().parseFromString(String(reader.result), "application/xml");
        if (xml.querySelector("parsererror")) throw new Error("Invalid XML");
        const root = xml.documentElement;
        if(root.localName!=="Project")throw new Error("Expected Microsoft Project Project element");
        const direct = (node, name) => [...(node?.children || [])].find((child) => child.localName === name);
        const children = (node, name) => [...(node?.children || [])].filter((child) => child.localName === name);
        const textOf = (node, name, fallback = "") => direct(node, name)?.textContent?.trim() || fallback;
        const minutesPerDay = Number(textOf(root, "MinutesPerDay", "480")) || 480;
        const projectStart = textOf(root, "StartDate").slice(0, 10) || state.project.startDate;
        const resourceNodes = children(direct(root, "Resources"), "Resource");
        const resources = new Map(resourceNodes.map((node) => [textOf(node, "UID"), textOf(node, "Name", "Unassigned")]));
        const assignmentNodes = children(direct(root, "Assignments"), "Assignment");
        const assignments = new Map();
        assignmentNodes.forEach((node) => {
          const taskUid = textOf(node, "TaskUID"), resourceUid = textOf(node, "ResourceUID"), units = Number(textOf(node, "Units", "1")) || 1;
          if (!assignments.has(taskUid)) assignments.set(taskUid, []);
          assignments.get(taskUid).push({ name: resources.get(resourceUid) || "Resource", units });
        });
        const taskNodes = children(direct(root, "Tasks"), "Task").filter((node) => textOf(node, "UID") !== "0" && textOf(node,"Null","0")!=="1");
        if(new Set(taskNodes.map(n=>textOf(n,"UID"))).size!==taskNodes.length || new Set(taskNodes.map(n=>textOf(n,"ID",textOf(n,"UID")))).size!==taskNodes.length)throw new Error("Duplicate Task UID/ID");
        const importWarnings = [];
        const uidToId = new Map(taskNodes.map((node) => [textOf(node, "UID"), `MSP${textOf(node, "ID", textOf(node, "UID"))}`]));
        const tasks = taskNodes.map((node) => {
          const uid = textOf(node, "UID"), start = textOf(node, "Start").slice(0, 10), finish = textOf(node, "Finish").slice(0, 10);
          const duration = parseMspDuration(textOf(node, "Duration"), minutesPerDay, start, finish);
          const links = children(node, "PredecessorLink").map((link) => {
            const predId = uidToId.get(textOf(link, "PredecessorUID"));
            if (!predId) { importWarnings.push(`Task ${uid}: missing predecessor UID ${textOf(link,"PredecessorUID")}`); return ""; }
            const type = ({ "0": "FF", "1": "FS", "2": "SF", "3": "SS" })[textOf(link, "Type", "1")] || "FS";
            const lag = Math.round((Number(textOf(link, "LinkLag", "0")) || 0) / 10 / minutesPerDay);
            if(Number(textOf(link,"LinkLag","0"))/10/minutesPerDay!==lag)importWarnings.push(`Task ${uid}: fractional lag rounded to ${lag} day(s)`);
            return `${predId}${type}${lag > 0 ? `+${lag}` : lag < 0 ? lag : ""}`;
          }).filter(Boolean);
          const assigned = assignments.get(uid) || [];
          const baselineContainer = direct(node, "Baselines");
          const baselines = [...children(node,"Baseline"),...children(baselineContainer,"Baseline")];
          const baseline = baselines.find(item=>textOf(item,"Number","0")==="0") || baselines[0];
          if(duration>999)importWarnings.push(`Task ${uid}: duration exceeds 999-day application limit`);
          const progress = clampNumber(textOf(node, "PercentComplete", "0"), 0, 100, 0);
          const summary = textOf(node, "Summary", "0") === "1";
          return {
            id: uidToId.get(uid),
            name: textOf(node, "Name", `Task ${uid}`),
            wbs: textOf(node, "WBS", textOf(node, "OutlineNumber", "General")),
            outlineLevel: Number(textOf(node, "OutlineLevel", "1")) || 1,
            summary,
            owner: assigned.map((item) => item.name).join(", ") || "Unassigned",
            resourceTeam: assigned.map((item) => item.name).join(" + ") || "Unassigned",
            manpower: Math.max(0, Math.ceil(assigned.reduce((sum, item) => sum + item.units, 0))),
            duration,
            milestone: textOf(node,"Milestone","0")==="1",
            actualStart: textOf(node,"ActualStart").slice(0,10),
            actualFinish: textOf(node,"ActualFinish").slice(0,10),
            sourceDuration: duration,
            plannedStart: start,
            plannedFinish: finish,
            predecessor: links.join(","),
            cost: Number(textOf(node, "Cost", "0")) || 0,
            actualCost: Number(textOf(node, "ActualCost", "0")) || 0,
            progress,
            status: progress >= 100 ? "done" : progress > 0 ? "in-progress" : "backlog",
            notes: textOf(node, "Notes").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(),
            baselineStart: baseline ? textOf(baseline, "Start").slice(0, 10) : "",
            baselineFinish: baseline ? textOf(baseline, "Finish").slice(0, 10) : "",
            baselineCost: baseline ? Number(textOf(baseline, "Cost", "0")) || 0 : 0
          };
        });
        if (!tasks.length) throw new Error("No tasks found");
        const summaryCount = tasks.filter((task) => task.summary).length;
        pendingXmlImport = normalizeState({
          project: {
            name: textOf(root, "Title", textOf(root, "Name", file.name.replace(/\.xml$/i, ""))),
            startDate: projectStart,
            dataDate: (textOf(root, "StatusDate") || textOf(root, "CurrentDate") || projectStart).slice(0, 10),
            budget: tasks.reduce((sum, task) => sum + (task.summary ? 0 : task.cost), 0),
            currency: textOf(root, "CurrencyCode", "THB"),
            resourceCapacity: state.project.resourceCapacity || 70,
            calendar: state.project.calendar,
            holidays: state.project.holidays,
            note: `Imported from Microsoft Project XML: ${file.name}`
          },
          tasks,
          ui: { ...state.ui, activeView: "schedule" }
        });
        if(onPreview){onPreview({candidate:pendingXmlImport,warnings:importWarnings});return;}
        const previous=state;let comparison;
        try { state=pendingXmlImport;comparison=buildSchedule(); } finally { state=previous; }
        const shifted=comparison.rows.filter(row=>row.task.plannedStart&&toISO(row.startDate)!==row.task.plannedStart||row.task.plannedFinish&&toISO(row.endDate)!==row.task.plannedFinish);
        pilotDialog("MS Project XML — พรีวิวก่อนนำเข้า", `<p><b>${tasks.length} กิจกรรม · ${summaryCount} Summary · ${tasks.filter(t=>t.milestone).length} Milestone</b><br>${tasks.filter(t=>t.baselineStart).length} Baseline · ${assignmentNodes.length} Assignments · ${tasks.filter(t=>t.predecessor).length} งานมี dependency</p><p>รองรับ: WBS/Outline, วันที่แผน, FS/FF/SS/SF, progress, cost, Actual dates และ Baseline 0</p><div class="xml-warnings"><b>ข้อจำกัดที่ต้องตรวจ</b><ul><li>ปฏิทินราย Task/Resource, exceptions, time-of-day, elapsed duration และ constraints ของ MS Project ยังไม่ถ่ายโอน ใช้ปฏิทินร่วมที่เลือกด้านล่าง</li><li>Lag เศษวันปัดเป็นวันเต็ม Assignment units ไม่ใช่จำนวนคนโดยตรง กรุณาตรวจ manpower</li><li>ไม่แปลงประวัติ Actual รายงวดจาก XML ค่า Actual ที่นำเข้าจะเป็น snapshot ณ Status Date</li><li>ผลเปรียบเทียบด้านล่างใช้ปฏิทิน ${escapeHtml(pendingXmlImport.project.calendar)} ที่เปิดอยู่ ไม่รับรองผลเหมือน MS Project</li></ul>${importWarnings.map(w=>`<p>${escapeHtml(w)}</p>`).join("")}${comparison.issues.map(i=>`<p>${escapeHtml(i.taskId+": "+i.message)}</p>`).join("")}</div><label>ปฏิทินร่วมหลังนำเข้า<select id="xml-calendar"><option value="calendar">7 วัน / Calendar</option><option value="work6">จันทร์–เสาร์</option><option value="work5">จันทร์–ศุกร์</option></select></label><p>${shifted.length} งานที่วันคำนวณต่างจากต้นฉบับ</p><div class="table-scroll"><table class="data-table"><thead><tr><th>ID / WBS</th><th>กิจกรรม</th><th>XML Start / Finish</th><th>GO Start / Finish</th><th>ประเภท / Dependency</th><th>Baseline 0</th></tr></thead><tbody>${comparison.rows.map(r=>`<tr><td>${escapeHtml(r.task.id)}<br>${escapeHtml(r.task.wbs)}</td><td>${escapeHtml(r.task.name)}</td><td>${escapeHtml(r.task.plannedStart)}<br>${escapeHtml(r.task.plannedFinish)}</td><td>${toISO(r.startDate)}<br>${toISO(r.endDate)}</td><td>${r.task.summary?"Summary":r.task.milestone?"Milestone":"Task"}<br>${escapeHtml(r.task.predecessor)}</td><td>${escapeHtml(r.task.baselineStart)}<br>${escapeHtml(r.task.baselineFinish)}</td></tr>`).join("")}</tbody></table></div><label><input type="checkbox" id="xml-ack"> เข้าใจข้อจำกัดและยืนยันแทนที่โครงการปัจจุบัน (ดาวน์โหลด Backup เดิมก่อนแทนที่)</label><p id="xml-error" class="bad" role="alert"></p><button data-confirm-xml>สำรองเดิมและนำเข้า</button><button data-pilot="close">ยกเลิก</button>`);
        const calendarSelect=document.getElementById("xml-calendar");calendarSelect.value=pendingXmlImport.project.calendar;
        calendarSelect.addEventListener("change",()=>{
          pendingXmlImport.project.calendar=calendarSelect.value;
          const previous=state;let revised;try{state=pendingXmlImport;revised=buildSchedule();}finally{state=previous;}
          const rows=document.querySelectorAll("#pilot-dialog tbody tr");
          revised.rows.forEach((r,i)=>{if(rows[i])rows[i].cells[3].innerHTML=`${toISO(r.startDate)}<br>${toISO(r.endDate)}`;});
          calendarSelect.closest("label").nextElementSibling.textContent=`${revised.rows.filter(r=>toISO(r.startDate)!==r.task.plannedStart||toISO(r.endDate)!==r.task.plannedFinish).length} งานที่วันคำนวณต่างจากต้นฉบับ · ${calendarSelect.value}`;
          document.getElementById("xml-error").textContent=revised.issues.map(i=>`${i.taskId}: ${i.message}`).join(" · ");
        });
      } catch (error) {
        console.error(error);
        if(onPreview)onPreview({error:String(error.message)});
        else showToast(`Could not import XML: ${error.message}`, "error");
      } finally {
        event.target.value = "";
      }
    };
    reader.readAsText(file);
  }

  function parseMspDuration(value, minutesPerDay, start, finish) {
    const match = String(value || "").match(/^P(?:(\d+)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/i);
    if (match) {
      const minutes = Number(match[1] || 0) * minutesPerDay + Number(match[2] || 0) * 60 + Number(match[3] || 0) + Number(match[4] || 0) / 60;
      if(minutes===0)return 0;
      if (minutes > 0) return Math.max(1, Math.ceil(minutes / minutesPerDay));
    }
    if (isISODate(start) && isISODate(finish)) return Math.max(1, diffDays(fromISO(start), fromISO(finish)) + 1);
    return 1;
  }

  function exportTaskCsv() {
    const schedule = currentSchedule || buildSchedule();
    const headers = ["ID", "Task", "WBS", "Owner", "Resource team", "People per day", "Person-days", "Duration days", "Predecessor", "Start", "Finish", "Baseline start", "Baseline finish", "Total float days", "Critical", "Budget cost", "Actual cost", "Progress percent", "Status", "Notes"];
    const rows = schedule.rows.map((row) => [
      row.task.id,
      row.task.name,
      row.task.wbs,
      row.task.owner,
      row.task.resourceTeam,
      row.task.manpower,
      row.task.summary||row.task.milestone?0:manpowerFor(row.task)*workdaysBetween(row.startDate,row.endDate),
      row.task.milestone?0:workdaysBetween(row.startDate,row.endDate),
      row.task.predecessor,
      toISO(row.startDate),
      toISO(row.endDate),
      row.task.baselineStart,
      row.task.baselineFinish,
      row.slack ?? "",
      row.critical ? "Yes" : "No",
      row.task.cost,
      row.task.actualCost,
      row.task.progress,
      STATUS_META[row.task.status].label,
      row.task.notes
    ]);
    const csv = [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n");
    downloadBlob(`\uFEFF${csv}`, `${slugify(state.project.name)}-task-register.csv`, "text/csv;charset=utf-8");
    showToast("Task register exported as CSV.", "success");
  }

  function resetDemo() {
    if (!window.confirm("Replace all local project data with the demonstration project?")) return;
    state = normalizeState(makeDemoState());
    saveState(true);
    renderAll();
    setView("dashboard", false);
    showToast("Demonstration project restored.", "success");
  }

  function nextTaskId() {
    const numbers = state.tasks.map((task) => Number((task.id.match(/\d+/) || [0])[0])).filter(Number.isFinite);
    const next = Math.ceil((Math.max(0, ...numbers) + 1) / 10) * 10;
    return `T${next || 10}`;
  }

  function showToast(message, type = "success") {
    const region = document.getElementById("toast-region");
    const toast = document.createElement("div");
    toast.className = `toast ${type}`;
    toast.textContent = message;
    region.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = "0";
      toast.style.transform = "translateY(6px)";
      setTimeout(() => toast.remove(), 200);
    }, 3000);
  }

  function downloadBlob(content, filename, type) {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function csvCell(value) {
    const text = String(value ?? "");
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  }

  function formatCurrency(value) {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: state.project.currency, maximumFractionDigits: 0 }).format(Number(value || 0));
  }

  function formatCompactCurrency(value) {
    const number = Number(value || 0);
    const absolute = Math.abs(number);
    const symbol = currencySymbol(state.project.currency);
    if (absolute >= 1000000000) return `${number < 0 ? "−" : ""}${symbol}${round1(absolute / 1000000000)}B`;
    if (absolute >= 1000000) return `${number < 0 ? "−" : ""}${symbol}${round1(absolute / 1000000)}M`;
    if (absolute >= 1000) return `${number < 0 ? "−" : ""}${symbol}${round1(absolute / 1000)}K`;
    return `${number < 0 ? "−" : ""}${symbol}${Math.round(absolute).toLocaleString("en-US")}`;
  }

  function formatAxisCurrency(value) {
    const number = Number(value || 0);
    if (number >= 1000000) return `${round1(number / 1000000)}M`;
    if (number >= 1000) return `${round1(number / 1000)}K`;
    return String(Math.round(number));
  }

  function formatSignedCurrency(value) {
    const number = Number(value || 0);
    return `${number >= 0 ? "+" : "−"}${formatCompactCurrency(Math.abs(number))}`;
  }

  function currencySymbol(currency) {
    return { THB: "฿", USD: "$", EUR: "€", GBP: "£", SGD: "S$" }[currency] || `${currency} `;
  }

  function formatDate(date, withYear = false) {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "—";
    return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", ...(withYear ? { year: "numeric" } : {}) }).format(date);
  }

  function formatLongDate(date) {
    return new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "2-digit", month: "long", year: "numeric" }).format(date);
  }

  function formatMonthYear(date) {
    return new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric" }).format(date);
  }

  function formatMonthDay(date) {
    return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short" }).format(date);
  }

  function formatDayShort(date) {
    return new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "2-digit" }).format(date);
  }

  function monthKey(date) {
    return `${date.getFullYear()}-${date.getMonth()}`;
  }

  function toISO(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function fromISO(value) {
    const [year, month, day] = String(value).split("-").map(Number);
    return startOfDay(new Date(year, month - 1, day));
  }

  function isISODate(value) {
    return /^\d{4}-\d{2}-\d{2}$/.test(String(value)) && !Number.isNaN(fromISO(value).getTime()) && toISO(fromISO(value))===String(value);
  }

  function startOfDay(date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
  }

  function addDays(date, days) {
    const result = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    result.setDate(result.getDate() + Number(days || 0));
    return result;
  }

  function diffDays(from, to) {
    return Math.round((startOfDay(to) - startOfDay(from)) / 86400000);
  }

  function round1(value) {
    const rounded = Math.round(Number(value || 0) * 10) / 10;
    return Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(1);
  }

  function formatSigned(value, digits = 1) {
    const number = Number(value || 0);
    return `${number >= 0 ? "+" : "−"}${Math.abs(number).toFixed(digits)}`;
  }

  function clampNumber(value, min, max, fallback) {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.min(max, Math.max(min, number));
  }

  function performanceClass(value) {
    if (!Number.isFinite(value)) return "neutral";
    if (value >= 0.98) return "good";
    if (value >= 0.9) return "warn";
    return "bad";
  }

  function niceCeil(value) {
    if (value <= 0) return 1;
    const exponent = Math.floor(Math.log10(value));
    const fraction = value / Math.pow(10, exponent);
    let nice;
    if (fraction <= 1) nice = 1;
    else if (fraction <= 2) nice = 2;
    else if (fraction <= 5) nice = 5;
    else nice = 10;
    return nice * Math.pow(10, exponent);
  }

  function nearestSampleIndex(sampleIndexes, dayIndex) {
    if (!sampleIndexes.length || dayIndex < 0) return -1;
    let best = 0;
    let distance = Infinity;
    sampleIndexes.forEach((value, index) => {
      const nextDistance = Math.abs(value - dayIndex);
      if (nextDistance < distance) {
        best = index;
        distance = nextDistance;
      }
    });
    return best;
  }

  function initials(name) {
    return String(name).split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "?";
  }

  function slugify(value) {
    return String(value || "project").toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "project";
  }

  function cssEscape(value) {
    if (window.CSS && typeof window.CSS.escape === "function") return window.CSS.escape(value);
    return String(value).replace(/[^a-zA-Z0-9_-]/g, "\\$&");
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
  }

  function escapeAttr(value) {
    return escapeHtml(value).replace(/\n/g, "&#10;");
  }

  function initLanguage() {
    const words={"Dashboard":"ภาพรวม","Gantt & tasks":"แผนงานและกิจกรรม","Critical Path":"เส้นทางวิกฤต","Kanban":"กระดานงาน","Cost & S-curve":"ต้นทุนและ S-Curve","Resource histogram":"กำลังคน","3-week look ahead":"แผนล่วงหน้า 3 สัปดาห์","Project settings":"ตั้งค่าโครงการ","Today":"วันนี้","Export":"ส่งออก","Print":"พิมพ์","Paper":"กระดาษ","Add task":"เพิ่มกิจกรรม","＋ Add task":"＋ เพิ่มกิจกรรม","Active project":"โครงการปัจจุบัน","Gantt chart & task register":"แผนงาน Gantt และทะเบียนกิจกรรม","Month":"เดือน","Week":"สัปดาห์","Day":"วัน","Hide table":"ซ่อนตาราง","Show table":"แสดงตาราง","Width":"ความกว้าง","Columns":"คอลัมน์","All":"ทั้งหมด","Critical":"วิกฤต","Critical only":"เฉพาะวิกฤต","Set baseline":"บันทึกแผนฐาน","Baseline":"แผนฐาน","Planned":"แผน","Progress":"ความก้าวหน้า","Timeline":"ระยะเวลาโครงการ","Task register":"ทะเบียนกิจกรรม","Dependencies, dates and cost":"ความสัมพันธ์ วันที่ และต้นทุน","General information":"ข้อมูลทั่วไป","Project name":"ชื่อโครงการ","Project start":"วันเริ่มโครงการ","Approved budget":"งบประมาณอนุมัติ","Data date":"วันที่รายงาน","Project note":"หมายเหตุโครงการ","Save project settings":"บันทึกการตั้งค่า","Backup & restore":"สำรองและกู้คืน","Data management":"จัดการข้อมูล","Export project backup":"สำรองโครงการ","Import project backup":"กู้คืนโครงการ","Import Microsoft Project XML":"นำเข้า XML จาก Microsoft Project","Export task register":"ส่งออกทะเบียนกิจกรรม","Add task":"เพิ่มกิจกรรม","Edit task":"แก้ไขกิจกรรม","Cancel":"ยกเลิก","Save task":"บันทึกกิจกรรม","Delete task":"ลบกิจกรรม","Task name":"ชื่อกิจกรรม","Owner":"ผู้รับผิดชอบ","Start":"เริ่ม","Finish":"จบ","Days":"วัน","Status":"สถานะ","Cost":"ต้นทุน","Duration":"ระยะเวลา","Predecessor":"กิจกรรมก่อนหน้า","Notes":"หมายเหตุ","Summary":"สรุป","Weekly detail":"รายละเอียดรายสัปดาห์","Monthly from weeks":"รายเดือนจากสัปดาห์","Plan / period":"แผนรายงวด","Sum Plan":"แผนสะสม","Actual / period":"ผลงานรายงวด","Sum Actual":"ผลงานสะสม","Plan value / period":"มูลค่าแผนรายงวด","Sum Plan value":"มูลค่าแผนสะสม","Actual value / period":"มูลค่าผลงานรายงวด","Sum Actual value":"มูลค่าผลงานสะสม","Progress control":"ควบคุมความก้าวหน้า","Weekly progress & monthly accumulation":"ความก้าวหน้ารายสัปดาห์และสะสมรายเดือน","Overlay S-curve on Gantt":"ซ้อน S-Curve บน Gantt","Fit diagram":"จัดกราฟพอดีจอ","Show all":"แสดงทั้งหมด","โครงการ":"Projects","เริ่มต้น":"Quick Start","ตรวจข้อมูล":"Validation","ตั้งค่าพิมพ์":"Print options"};
    let language=localStorage.getItem("go-planner.language")||"th"; const originals=new WeakMap();
    const apply=()=>{observer.disconnect();document.documentElement.lang=language;const walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);let node;
      while(node=walker.nextNode()){if(node.parentElement?.closest("script,style,textarea,input,.gantt-bar-text,.task-cell,.gantt-col.name,.project-title-row h1"))continue;
        const current=node.nodeValue.trim(), prior=originals.get(node);if(prior && current!==prior.translated && current!==prior.original)originals.delete(node);
        const saved=originals.get(node),original=saved?.original||current;
        const replacement=language==="th"?words[original]||original:({"โครงการ":"Projects","เริ่มต้น":"Quick Start","ตรวจข้อมูล":"Validation","ตั้งค่าพิมพ์":"Print options"}[original]||original);
        if(replacement!==current){node.nodeValue=node.nodeValue.replace(current,replacement);originals.set(node,{original,translated:replacement});}
      }
      observer.observe(document.body,{childList:true,subtree:true,characterData:true});};
    let pending=false;const observer=new MutationObserver(()=>{if(!pending){pending=true;queueMicrotask(()=>{pending=false;apply();});}});
    const select=document.getElementById("pilot-language");select.value=language;select.addEventListener("change",()=>{language=select.value;localStorage.setItem("go-planner.language",language);apply();});apply();
  }

  const PILOT_KEY = "go-project-planner.projects.v1";
  let pilotProjects = { active:"", items:[] };
  function persistPilotProject() {
    const item = pilotProjects.items.find(p => p.id === pilotProjects.active);
    if (item) { item.data = JSON.parse(JSON.stringify(state)); item.updated = new Date().toISOString(); }
    localStorage.setItem(PILOT_KEY, JSON.stringify(pilotProjects));
  }
  function pilotDialog(title, content) {
    const old = document.getElementById("pilot-dialog"); if (old) old.remove();
    const dialog = document.createElement("dialog"); dialog.id="pilot-dialog"; dialog.className="pilot-dialog";
    dialog.innerHTML=`<header><h2>${escapeHtml(title)}</h2><button type="button" data-pilot="close" aria-label="Close">×</button></header>${content}`;
    document.body.appendChild(dialog); dialog.showModal();
  }
  function projectList() {
    pilotDialog("โครงการของฉัน / Projects", `<p class="pilot-note">ข้อมูลอยู่ในเบราว์เซอร์เครื่องนี้ ไม่ใช่ฐานข้อมูลร่วมกัน กรุณาสำรองก่อนเปลี่ยนเครื่อง</p><div class="pilot-actions"><button data-pilot="new">สร้างโครงการ</button><button data-pilot="duplicate">ทำสำเนา</button><button data-pilot="backup">สำรองทุกโครงการ</button><button data-pilot="restore">กู้คืนไฟล์</button></div><div class="pilot-projects">${pilotProjects.items.map(p=>`<article><div><strong>${escapeHtml(p.data.project.name)}</strong><small>${p.data.tasks.length} กิจกรรม · ${p.id===pilotProjects.active ? "กำลังเปิด" : ""}</small></div><button data-open-project="${escapeAttr(p.id)}">เปิด</button><button data-delete-project="${escapeAttr(p.id)}">ลบ</button></article>`).join("")}</div>`);
  }
  function downloadPilot(name, data) {
    const a=document.createElement("a"), url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:"application/json"}));
    a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  function openPilotProject(id) {
    persistPilotProject();const item=pilotProjects.items.find(p=>p.id===id);if(!item)return;
    state=normalizeState(item.data);pilotProjects.active=id;historyPast=[];historyFuture=[];historySnapshot=JSON.stringify({project:state.project,tasks:state.tasks});
    saveState(true);renderAll();setView(state.ui.activeView||"dashboard",false);document.getElementById("pilot-dialog")?.close();
  }
  function validationPilot() {
    const schedule=buildSchedule(), issues=[...schedule.issues];
    schedule.rows.forEach(row=>{
      if(!row.task.summary && !row.predecessors.length)issues.push({type:"info",taskId:row.task.id,message:"ไม่มี predecessor — ตรวจว่าเป็นงานเริ่มต้นจริงหรือไม่"});
      if(row.task.actualFinish && row.task.progress<100)issues.push({type:"warning",taskId:row.task.id,message:"มีวันจบจริง แต่ความก้าวหน้ายังไม่ถึง 100%"});
      if(row.task.progress>0 && !row.task.actualStart)issues.push({type:"warning",taskId:row.task.id,message:"มีความก้าวหน้า แต่ยังไม่ระบุวันเริ่มจริง"});
      if(row.task.actualStart>state.project.dataDate || row.task.actualFinish>state.project.dataDate)issues.push({type:"warning",taskId:row.task.id,message:"วันที่จริงอยู่หลัง Data Date"});
    });
    pilotDialog("ศูนย์ตรวจข้อมูล / Validation", `<p class="pilot-note">${issues.length} รายการ · ข้อมูลแจ้งเตือนไม่ได้หมายถึงข้อผิดพลาดทุกกรณี</p><div class="pilot-issues">${issues.map(i=>`<article class="${i.type}"><strong>${escapeHtml(i.taskId||"PROJECT")}</strong><p>${escapeHtml(i.message)}</p>${state.tasks.some(t=>t.id.toUpperCase()===String(i.taskId).toUpperCase())?`<button data-pilot-edit="${escapeAttr(i.taskId)}">แก้ไขกิจกรรม</button>`:""}</article>`).join("")||"ไม่พบปัญหา"}</div>`);
  }
  function pilotHistory(direction) {
    const source=direction==="undo"?historyPast:historyFuture,target=direction==="undo"?historyFuture:historyPast;
    if(!source.length){showToast("ไม่มีรายการให้ย้อนกลับ");return;}
    target.push(historySnapshot);const restored=JSON.parse(source.pop());state=normalizeState({...state,...restored});historySnapshot=JSON.stringify(restored);
    saveState(true);renderAll();showToast(direction==="undo"?"ย้อนกลับแล้ว":"ทำซ้ำแล้ว","success");
  }
  function quickStartPilot() {
    pilotDialog("เริ่มต้นใช้งาน / Quick Start", `<div class="pilot-guide"><h3>1. สร้างหรือเปิดโครงการ</h3><p>ใช้ปุ่มโครงการ หรือ Settings เพื่อนำเข้า JSON / Microsoft Project XML</p><h3>2. ตั้งปฏิทินโครงการ</h3><p>เลือก 5/6/7 วันทำงานและกรอกวันหยุด YYYY-MM-DD ระยะเวลาและ Lag/Lead นับตามวันทำงาน</p><h3>3. วางแผนและเก็บ Baseline</h3><p>เพิ่มกิจกรรม เลือก Milestone สำหรับจุดส่งมอบ 0 วัน ตรวจ Dependency และบันทึกแผนฐาน</p><h3>4. อัปเดตและ Forecast</h3><p>ตั้ง Data Date กรอก Actual Start/Finish และ Remaining Duration แล้วเปิด Forecast ใน Settings วันที่จริงจะไม่ถูกแก้โดย dependency แต่จะแสดงคำเตือน</p><h3>5. ตรวจและสำรอง</h3><p>ใช้ศูนย์ตรวจข้อมูลก่อนรายงาน และสำรองก่อนเปลี่ยนเครื่อง</p><p class="pilot-note">ใช้ปฏิทินร่วมหนึ่งชุด ไม่รองรับปฏิทินราย Resource หรือ Resource Leveling ภาษาไทยครอบคลุมเมนูหลัก ข้อความรายละเอียดบางส่วนยังเป็นอังกฤษ</p></div><button data-pilot="close">เริ่มใช้งาน</button>`);
  }
  function initPilot() {
    try { const saved=JSON.parse(localStorage.getItem(PILOT_KEY));if(saved && Array.isArray(saved.items))pilotProjects=saved; } catch{}
    if(!pilotProjects.items.length){pilotProjects.active=crypto.randomUUID();pilotProjects.items=[{id:pilotProjects.active,data:JSON.parse(JSON.stringify(state))}];}
    historySnapshot=JSON.stringify({project:state.project,tasks:state.tasks});
    const bar=document.createElement("div");bar.className="pilot-bar";bar.innerHTML=`<span class="pilot-version">Pilot 0.8 · ข้อมูลในเครื่อง</span><button data-pilot="projects">โครงการ</button><button data-pilot="guide">เริ่มต้น</button><button data-pilot="undo">Undo</button><button data-pilot="redo">Redo</button><button data-pilot="validate">ตรวจข้อมูล</button><button data-pilot="print">ตั้งค่าพิมพ์</button><button data-pilot="feedback">Feedback</button><select id="pilot-language" aria-label="Language"><option value="th">ไทย</option><option value="en">English</option></select>`;
    bar.querySelector(".pilot-version").textContent="Pilot 0.9 · ข้อมูลในเครื่อง";
    const logButton=document.createElement("button");logButton.dataset.weeklyActual="";logButton.textContent="Actual รายสัปดาห์";bar.insertBefore(logButton,bar.querySelector("select"));
    document.querySelector(".topbar").after(bar);
    initLanguage();
    const restore=document.createElement("input");restore.type="file";restore.accept=".json";restore.hidden=true;document.body.appendChild(restore);
    restore.addEventListener("change",async()=>{
      try { const data=JSON.parse(await restore.files[0].text());if(data.format!=="GO_PILOT_BACKUP"||!Array.isArray(data.items)||!data.items.length)throw Error();
        const items=data.items.map(p=>({id:crypto.randomUUID(),data:normalizeState(p.data)}));pilotProjects.items.push(...items);persistPilotProject();projectList();showToast("กู้คืนเป็นสำเนา ไม่ทับข้อมูลเดิม","success");
      }catch{showToast("ไฟล์สำรองไม่ถูกต้อง","error");}restore.value="";
    });
    document.addEventListener("click",e=>{
      const open=e.target.closest("[data-open-project]");if(open){openPilotProject(open.dataset.openProject);return;}
      const del=e.target.closest("[data-delete-project]");if(del){if(pilotProjects.items.length===1){showToast("ต้องเหลืออย่างน้อยหนึ่งโครงการ");return;}if(!confirm("สำรองข้อมูลก่อนลบ ต้องการลบโครงการนี้?"))return;
        downloadPilot("GO-before-delete.json",{format:"GO_PILOT_BACKUP",items:pilotProjects.items.filter(p=>p.id===del.dataset.deleteProject)});
        const active=pilotProjects.active===del.dataset.deleteProject;pilotProjects.items=pilotProjects.items.filter(p=>p.id!==del.dataset.deleteProject);if(active)openPilotProject(pilotProjects.items[0].id);else persistPilotProject();projectList();return;}
      const edit=e.target.closest("[data-pilot-edit]");if(edit){document.getElementById("pilot-dialog").close();openTaskModal(edit.dataset.pilotEdit);return;}
      const action=e.target.closest("[data-pilot]")?.dataset.pilot;if(!action)return;
      if(action==="close")document.getElementById("pilot-dialog")?.close();
      if(action==="projects")projectList();if(action==="guide")quickStartPilot();
      if(action==="validate")validationPilot();if(action==="undo"||action==="redo")pilotHistory(action);
      if(action==="backup"){persistPilotProject();downloadPilot("GO-projects-backup.json",{format:"GO_PILOT_BACKUP",items:pilotProjects.items});}
      if(action==="restore")restore.click();
      if(action==="new"||action==="duplicate"){
        const name=prompt("ชื่อโครงการ",action==="duplicate"?state.project.name+" — สำเนา":"โครงการใหม่");if(!name?.trim())return;
        persistPilotProject();const data=JSON.parse(JSON.stringify(state));data.project.name=name.trim();if(action==="new")data.tasks=[];
        const item={id:crypto.randomUUID(),data};pilotProjects.items.push(item);openPilotProject(item.id);
      }
      if(action==="feedback")pilotDialog("Feedback", `<p>อธิบายปัญหา ขั้นตอนที่ทำ ผลที่คาดหวัง และแนบภาพเมื่อส่งให้ผู้พัฒนา</p><textarea id="pilot-feedback" rows="6" placeholder="เมนู / ขั้นตอน / ผลที่เกิดขึ้น"></textarea><p class="pilot-note">รายงานจะดาวน์โหลดลงเครื่อง ไม่ส่งอัตโนมัติ และไม่แนบข้อมูลโครงการ</p><button data-pilot="download-feedback">ดาวน์โหลดรายงาน</button>`);
      if(action==="download-feedback")downloadPilot("GO-feedback.json",{version:"0.7",date:new Date().toISOString(),message:document.getElementById("pilot-feedback").value});
      if(action==="print")pilotDialog("ตั้งค่าพิมพ์ / Print", `<p>ใช้แถวและคอลัมน์ที่มองเห็นหลังค้นหาและยุบ WBS ในหน้า Gantt กราฟและตารางสรุปจะย่อร่วมกัน ไม่ตัดส่วนที่อยู่นอกจอ</p><label>กระดาษ <select id="pilot-paper"><option>A3</option><option>A4</option></select></label><label>จัดหน้า<select id="pilot-fit"><option value="page">Gantt + ตารางสรุป พอดีหน้าเดียว</option><option value="width">พอดีความกว้าง (หลายหน้าตามความสูง)</option></select></label><label><input id="pilot-register" type="checkbox" checked> รวม Task Register (หน้าใหม่)</label><label><input id="pilot-summary" type="checkbox" checked> รวมตาราง S-Curve</label><p class="pilot-note">งานจำนวนมากจะมีตัวอักษรเล็กเมื่อย่อหน้าเดียว แนะนำ A3 หรือกรอง/ยุบ WBS และตรวจ Print Preview จริง เปิด Background graphics หากเบราว์เซอร์ปิดสีพื้นหลัง</p><button data-pilot="do-print">เปิด Print Preview</button>`);
      if(action==="do-print"){
        document.body.dataset.printFit=document.getElementById("pilot-fit").value;
        document.body.classList.toggle("pilot-hide-register",!document.getElementById("pilot-register").checked);document.body.classList.toggle("pilot-hide-summary",!document.getElementById("pilot-summary").checked);
        document.getElementById("print-paper-size").value=document.getElementById("pilot-paper").value;document.getElementById("pilot-dialog").close();printView(state.ui.activeView);
      }
    });
    document.addEventListener("keydown",e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==="z"&&!e.target.matches("input,textarea")){e.preventDefault();pilotHistory(e.shiftKey?"redo":"undo");}});
    window.addEventListener("afterprint",()=>document.body.classList.remove("pilot-hide-register","pilot-hide-summary"));
  }

  Object.defineProperty(window, "__GO_PLANNER_TEST__", { value: {
    parsePredecessors,
    normalizeActualHistory,
    isISODate,
    importXml(file) { return new Promise(resolve=>importMicrosoftProjectXml({target:{files:[file],value:""}},resolve)); },
    inspect(tasks,project={}) {
      const previous=state;
      try {state=normalizeState({project:{startDate:"2026-01-01",dataDate:"2026-01-21",...project},tasks,ui:{}});const schedule=buildSchedule(),progress=buildProgressSeries(schedule);return {progress,weekly:progressBuckets(schedule,progress,"week"),monthly:progressBuckets(schedule,progress,"month"),cost:buildSCurve(schedule),resource:resourceSeries(schedule),metrics:calculatePerformance(schedule),tasks:state.tasks};}finally{state=previous;}
    },
    build(tasks, startDate = "2026-01-01", project = {}) {
      const previous = state;
      state = normalizeState({ project: { startDate, ...project }, tasks, ui: {} });
      const schedule = buildSchedule();
      state = previous;
      return schedule;
    }
  }, enumerable: false });

  window.addEventListener("DOMContentLoaded", init);
})();
