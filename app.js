/* Random Caller (local-only)
   - Fair round-robin selection (no repeats until everyone has been called)
   - Manual "Start New Round"
   - Counts only (no attempt logs, no timestamps)

   Data model:
   {
     version: 2,
     classes: [
       { id, name, students: [ { id, name, correct, incorrect, calledThisRound } ] }
     ]
   }
*/

const STORAGE_KEY = "random_caller_v2";

const $ = (id) => document.getElementById(id);

const el = {
  classSelect: $("classSelect"),
  manageClassSelect: $("manageClassSelect"),
  statusPill: $("statusPill"),

  pickBtn: $("pickBtn"),
  correctBtn: $("correctBtn"),
  incorrectBtn: $("incorrectBtn"),
  repickBtn: $("repickBtn"),
  newRoundBtn: $("newRoundBtn"),

  pickedName: $("pickedName"),
  pickedSub: $("pickedSub"),

  newClassName: $("newClassName"),
  addClassBtn: $("addClassBtn"),
  deleteClassBtn: $("deleteClassBtn"),

  studentNameInput: $("studentNameInput"),
  addStudentBtn: $("addStudentBtn"),

  bulkInput: $("bulkInput"),
  bulkImportBtn: $("bulkImportBtn"),
  clearBulkBtn: $("clearBulkBtn"),

  searchInput: $("searchInput"),
  studentList: $("studentList"),

  resetStatsBtn: $("resetStatsBtn"),

  exportCsvBtn: $("exportCsvBtn"),
  exportJsonBtn: $("exportJsonBtn"),
  toast: $("toast"),
};

let state = loadState();
let currentClassId = null;
let pickedStudentId = null;

function uuid() {
  return Math.random().toString(16).slice(2) + Date.now().toString(16);
}

function defaultState() {
  return {
    version: 2,
    classes: [
      { id: uuid(), name: "Class 1", students: [] },
      { id: uuid(), name: "Class 2", students: [] },
      { id: uuid(), name: "Class 3", students: [] },
    ]
  };
}

/** Migrate older saves (v1) if needed */
function migrateIfNeeded(parsed) {
  if (!parsed || typeof parsed !== "object") return defaultState();

  // v1 -> v2 migration
  if (parsed.version === 1 && Array.isArray(parsed.classes)) {
    const migrated = {
      version: 2,
      classes: parsed.classes.map(c => ({
        id: c.id || uuid(),
        name: c.name || "Class",
        students: Array.isArray(c.students) ? c.students.map(s => ({
          id: s.id || uuid(),
          name: s.name || "Student",
          correct: Number(s.correct || 0),
          incorrect: Number(s.incorrect || 0),
          calledThisRound: false,
        })) : []
      }))
    };
    return migrated;
  }

  // already v2-ish
  if (parsed.version === 2 && Array.isArray(parsed.classes)) {
    // Ensure required fields exist
    parsed.classes.forEach(c => {
      if (!Array.isArray(c.students)) c.students = [];
      c.students.forEach(s => {
        if (typeof s.correct !== "number") s.correct = Number(s.correct || 0);
        if (typeof s.incorrect !== "number") s.incorrect = Number(s.incorrect || 0);
        if (typeof s.calledThisRound !== "boolean") s.calledThisRound = false;
      });
    });
    return parsed;
  }

  return defaultState();
}

function loadState() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    // also try old key from earlier drafts (optional)
    const rawOld = localStorage.getItem("random_caller_v1");
    if (!rawOld) return defaultState();
    try {
      return migrateIfNeeded(JSON.parse(rawOld));
    } catch {
      return defaultState();
    }
  }
  try {
    return migrateIfNeeded(JSON.parse(raw));
  } catch {
    return defaultState();
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function toast(msg) {
  el.toast.textContent = msg;
  el.toast.classList.add("show");
  setTimeout(() => el.toast.classList.remove("show"), 1400);
}

function getClassById(id) {
  return state.classes.find(c => c.id === id) || null;
}

function getCurrentClass() {
  if (!currentClassId) return null;
  return getClassById(currentClassId);
}

function normalizeName(name) {
  return String(name || "").replace(/\s+/g, " ").trim();
}

function escapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function parseBulkInput(text) {
  const trimmed = String(text || "").trim();
  if (!trimmed) return [];

  const lines = trimmed.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (lines.length === 0) return [];

  const looksCsv = lines.some(l => l.includes(","));
  if (looksCsv) {
    const rows = lines.map(l =>
      l.split(",").map(x => x.trim().replace(/^"|"$/g, ""))
    );
    const start = rows[0] && /name/i.test(rows[0][0]) ? 1 : 0;
    return rows.slice(start).map(r => r[0]).filter(Boolean).map(normalizeName).filter(Boolean);
  }

  return lines.map(normalizeName).filter(Boolean);
}

/* ---------- Round-robin helpers ---------- */

function roundCounts(c) {
  const total = c.students.length;
  const called = c.students.filter(s => s.calledThisRound).length;
  return { called, total, remaining: total - called };
}

function updateStatusPill() {
  const c = getCurrentClass();
  if (!c) {
    el.statusPill.textContent = "No class selected";
    return;
  }
  const { called, total, remaining } = roundCounts(c);
  el.statusPill.textContent = `${c.name} • Round: ${called}/${total} • Remaining: ${remaining}`;
}

function setPickedStudent(student) {
  if (!student) {
    pickedStudentId = null;
    el.pickedName.textContent = "—";
    el.pickedSub.textContent = "Pick a student to begin.";
    el.correctBtn.disabled = true;
    el.incorrectBtn.disabled = true;
    el.repickBtn.disabled = true;
    return;
  }

  pickedStudentId = student.id;
  el.pickedName.textContent = student.name;

  const total = (student.correct || 0) + (student.incorrect || 0);
  const pct = total === 0 ? "—" : `${Math.round((student.correct / total) * 100)}%`;
  el.pickedSub.textContent = `Correct: ${student.correct || 0} • Incorrect: ${student.incorrect || 0} • Accuracy: ${pct}`;

  el.correctBtn.disabled = false;
  el.incorrectBtn.disabled = false;
  el.repickBtn.disabled = false;
}

function refreshClassDropdowns() {
  const options = state.classes.map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join("");
  el.classSelect.innerHTML = options;
  el.manageClassSelect.innerHTML = options;

  if (!currentClassId || !getClassById(currentClassId)) {
    currentClassId = state.classes[0]?.id || null;
  }

  if (currentClassId) {
    el.classSelect.value = currentClassId;
    el.manageClassSelect.value = currentClassId;
  }

  updateStatusPill();
  refreshPickControls();
}

function refreshPickControls() {
  const c = getCurrentClass();
  if (!c) {
    el.pickBtn.disabled = true;
    el.newRoundBtn.disabled = true;
    return;
  }

  const { remaining, total } = roundCounts(c);

  // If class empty, disable both
  if (total === 0) {
    el.pickBtn.disabled = true;
    el.newRoundBtn.disabled = true;
    if (!pickedStudentId) {
      el.pickedSub.textContent = "This class has no students yet.";
    }
    return;
  }

  // Manual reset: when round complete, disable Pick and enable Start New Round
  const roundComplete = remaining === 0;
  el.pickBtn.disabled = roundComplete;
  el.newRoundBtn.disabled = !roundComplete;

  if (roundComplete) {
    el.pickedSub.textContent = "Round complete — tap “Start New Round” when you’re ready.";
    setPickedStudent(null);
  }
}

function startNewRound() {
  const c = getCurrentClass();
  if (!c) return;

  if (c.students.length === 0) {
    toast("No students in this class");
    return;
  }

  for (const s of c.students) s.calledThisRound = false;

  saveState();
  toast("New round started");
  updateStatusPill();
  refreshStudentList();
  refreshPickControls();
}

/* ---------- Manage classes ---------- */

function addClass(name) {
  const clean = normalizeName(name);
  if (!clean) return;

  state.classes.push({ id: uuid(), name: clean, students: [] });
  saveState();
  toast("Class added");
  refreshClassDropdowns();
  refreshStudentList();
  setPickedStudent(null);
}

function deleteCurrentClass() {
  const c = getCurrentClass();
  if (!c) return;

  if (!confirm(`Delete class "${c.name}"? This removes all students & counts in it.`)) return;

  state.classes = state.classes.filter(x => x.id !== c.id);
  if (state.classes.length === 0) state = defaultState();

  currentClassId = state.classes[0].id;
  saveState();

  toast("Class deleted");
  refreshClassDropdowns();
  refreshStudentList();
  setPickedStudent(null);
}

/* ---------- Manage students ---------- */

function addStudent(name) {
  const c = getCurrentClass();
  if (!c) return;

  const clean = normalizeName(name);
  if (!clean) return;

  const exists = c.students.some(s => s.name.toLowerCase() === clean.toLowerCase());
  if (exists) {
    toast("Student already exists");
    return;
  }

  c.students.push({ id: uuid(), name: clean, correct: 0, incorrect: 0, calledThisRound: false });
  saveState();
  toast("Student added");
  refreshStudentList();
  updateStatusPill();
  refreshPickControls();
}

function deleteStudent(studentId) {
  const c = getCurrentClass();
  if (!c) return;

  const s = c.students.find(x => x.id === studentId);
  if (!s) return;

  if (!confirm(`Delete "${s.name}"?`)) return;

  c.students = c.students.filter(x => x.id !== studentId);
  if (pickedStudentId === studentId) setPickedStudent(null);

  saveState();
  toast("Student deleted");
  refreshStudentList();
  updateStatusPill();
  refreshPickControls();
}

function editStudent(studentId) {
  const c = getCurrentClass();
  if (!c) return;

  const s = c.students.find(x => x.id === studentId);
  if (!s) return;

  const newName = prompt("Edit student name:", s.name);
  if (newName === null) return;

  const clean = normalizeName(newName);
  if (!clean) return;

  const exists = c.students.some(x => x.id !== s.id && x.name.toLowerCase() === clean.toLowerCase());
  if (exists) {
    alert("Another student already has that name.");
    return;
  }

  s.name = clean;
  saveState();
  toast("Student updated");
  refreshStudentList();
  if (pickedStudentId === s.id) setPickedStudent(s);
}

function bulkImportStudents(text) {
  const c = getCurrentClass();
  if (!c) return;

  const names = parseBulkInput(text);
  if (names.length === 0) {
    toast("Nothing to import");
    return;
  }

  let added = 0;
  for (const nm of names) {
    const clean = normalizeName(nm);
    if (!clean) continue;

    const exists = c.students.some(s => s.name.toLowerCase() === clean.toLowerCase());
    if (exists) continue;

    c.students.push({ id: uuid(), name: clean, correct: 0, incorrect: 0, calledThisRound: false });
    added++;
  }

  saveState();
  toast(`Imported ${added} student${added === 1 ? "" : "s"}`);
  refreshStudentList();
  updateStatusPill();
  refreshPickControls();
}

/* ---------- Picking + marking ---------- */

function pickRandomStudent() {
  const c = getCurrentClass();
  if (!c) return;

  if (c.students.length === 0) {
    toast("No students in this class");
    setPickedStudent(null);
    refreshPickControls();
    return;
  }

  const eligible = c.students.filter(s => !s.calledThisRound);

  if (eligible.length === 0) {
    // Round complete; teacher must start new round manually
    refreshPickControls();
    toast("Round complete");
    return;
  }

  const idx = Math.floor(Math.random() * eligible.length);
  const s = eligible[idx];

  // mark as called for this round
  s.calledThisRound = true;

  saveState();
  setPickedStudent(s);
  refreshStudentList();
  updateStatusPill();
  refreshPickControls();
}

function markAnswer(isCorrect) {
  const c = getCurrentClass();
  if (!c || !pickedStudentId) return;

  const s = c.students.find(x => x.id === pickedStudentId);
  if (!s) return;

  if (isCorrect) s.correct = (s.correct || 0) + 1;
  else s.incorrect = (s.incorrect || 0) + 1;

  saveState();
  toast(isCorrect ? "Marked correct" : "Marked incorrect");
  setPickedStudent(s);
  refreshStudentList();
}

/* ---------- Lists / UI ---------- */

function refreshStudentList() {
  const c = getCurrentClass();
  el.studentList.innerHTML = "";
  if (!c) return;

  const q = (el.searchInput.value || "").toLowerCase().trim();
  const students = c.students
    .filter(s => !q || s.name.toLowerCase().includes(q))
    .sort((a, b) => a.name.localeCompare(b.name));

  if (students.length === 0) {
    el.studentList.innerHTML = `<div class="hint">No students match your search (or the class is empty).</div>`;
    return;
  }

  el.studentList.innerHTML = students.map(s => {
    const total = (s.correct || 0) + (s.incorrect || 0);
    const pct = total === 0 ? "—" : `${Math.round((s.correct / total) * 100)}%`;
    const rr = s.calledThisRound ? "Called this round" : "Not called yet";
    return `
      <div class="item" data-id="${s.id}">
        <div class="meta">
          <div class="name">${escapeHtml(s.name)}</div>
          <div class="stats">C: ${s.correct || 0} • I: ${s.incorrect || 0} • Acc: ${pct} • ${rr}</div>
        </div>
        <div class="actions">
          <button class="warn" data-action="edit">Edit</button>
          <button class="danger" data-action="delete">Delete</button>
        </div>
      </div>
    `;
  }).join("");

  el.studentList.querySelectorAll(".item button").forEach(btn => {
    btn.addEventListener("click", () => {
      const item = btn.closest(".item");
      const studentId = item.getAttribute("data-id");
      const action = btn.getAttribute("data-action");
      if (action === "delete") deleteStudent(studentId);
      if (action === "edit") editStudent(studentId);
    });
  });
}

function resetStatsForClass() {
  const c = getCurrentClass();
  if (!c) return;

  if (!confirm(`Reset all Correct/Incorrect counts for "${c.name}"?`)) return;

  for (const s of c.students) {
    s.correct = 0;
    s.incorrect = 0;
  }

  saveState();
  toast("Stats reset");
  setPickedStudent(null);
  refreshStudentList();
}

/* ---------- Export ---------- */

function exportCsv() {
  // CSV rows:
  // Class, Student, Correct, Incorrect, Total, Accuracy
  const rows = [];
  rows.push(["Class", "Student", "Correct", "Incorrect", "Total", "Accuracy"].join(","));

  for (const c of state.classes) {
    const students = [...c.students].sort((a, b) => a.name.localeCompare(b.name));
    for (const s of students) {
      const correct = s.correct || 0;
      const incorrect = s.incorrect || 0;
      const total = correct + incorrect;
      const accuracy = total === 0 ? "" : (correct / total).toFixed(4);
      rows.push([
        csvCell(c.name),
        csvCell(s.name),
        correct,
        incorrect,
        total,
        accuracy
      ].join(","));
    }
  }

  downloadFile(`random-caller-export-${dateStamp()}.csv`, rows.join("\n"), "text/csv;charset=utf-8");
}

function exportJson() {
  downloadFile(`random-caller-backup-${dateStamp()}.json`, JSON.stringify(state, null, 2), "application/json;charset=utf-8");
}

function csvCell(value) {
  const s = String(value ?? "");
  if (/[,"\n\r]/.test(s)) return `"${s.replaceAll
