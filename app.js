/* Random Caller (local-only) - copy-safe version (NO template literals)
   Spec:
   - Fair round-robin selection (no repeats until everyone has been called)
   - Manual "Start New Round" button
   - Counts only: correct / incorrect
   - Manage classes + students
   - Bulk import names (one per line or simple CSV)
   - Export CSV + Backup JSON
*/

"use strict";

var STORAGE_KEY = "random_caller_v2";

function $(id) { return document.getElementById(id); }

var el = {
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

  toast: $("toast")
};

var state = loadState();
var currentClassId = null;
var pickedStudentId = null;

/* ---------- Utilities ---------- */

function uuid() {
  return Math.random().toString(16).slice(2) + Date.now().toString(16);
}

function defaultState() {
  return {
    version: 2,
    classes: [
      { id: uuid(), name: "Class 1", students: [] },
      { id: uuid(), name: "Class 2", students: [] },
      { id: uuid(), name: "Class 3", students: [] }
    ]
  };
}

function migrateIfNeeded(parsed) {
  if (!parsed || typeof parsed !== "object") return defaultState();

  // v1 -> v2
  if (parsed.version === 1 && Array.isArray(parsed.classes)) {
    return {
      version: 2,
      classes: parsed.classes.map(function (c) {
        return {
          id: c.id || uuid(),
          name: c.name || "Class",
          students: Array.isArray(c.students) ? c.students.map(function (s) {
            return {
              id: s.id || uuid(),
              name: s.name || "Student",
              correct: Number(s.correct || 0),
              incorrect: Number(s.incorrect || 0),
              calledThisRound: false
            };
          }) : []
        };
      })
    };
  }

  // v2 normalize
  if (parsed.version === 2 && Array.isArray(parsed.classes)) {
    parsed.classes.forEach(function (c) {
      if (!Array.isArray(c.students)) c.students = [];
      c.students.forEach(function (s) {
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
  var raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    // try old key (optional)
    var rawOld = localStorage.getItem("random_caller_v1");
    if (!rawOld) return defaultState();
    try { return migrateIfNeeded(JSON.parse(rawOld)); }
    catch (e) { return defaultState(); }
  }
  try { return migrateIfNeeded(JSON.parse(raw)); }
  catch (e2) { return defaultState(); }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function toast(msg) {
  if (!el.toast) return;
  el.toast.textContent = msg;
  el.toast.classList.add("show");
  setTimeout(function () {
    el.toast.classList.remove("show");
  }, 1400);
}

function normalizeName(name) {
  return String(name || "").replace(/\s+/g, " ").trim();
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function parseBulkInput(text) {
  var trimmed = String(text || "").trim();
  if (!trimmed) return [];

  var lines = trimmed.split(/\r?\n/).map(function (l) { return l.trim(); }).filter(Boolean);
  if (lines.length === 0) return [];

  var looksCsv = lines.some(function (l) { return l.indexOf(",") !== -1; });
  if (looksCsv) {
    var rows = lines.map(function (l) {
      return l.split(",").map(function (x) {
        return x.trim().replace(/^"|"$/g, "");
      });
    });
    var start = (rows[0] && /name/i.test(rows[0][0])) ? 1 : 0;
    return rows.slice(start).map(function (r) { return r[0]; }).filter(Boolean).map(normalizeName).filter(Boolean);
  }

  return lines.map(normalizeName).filter(Boolean);
}

function getClassById(id) {
  for (var i = 0; i < state.classes.length; i++) {
    if (state.classes[i].id === id) return state.classes[i];
  }
  return null;
}

function getCurrentClass() {
  if (!currentClassId) return null;
  return getClassById(currentClassId);
}

/* ---------- Round-robin ---------- */

function roundCounts(c) {
  var total = c.students.length;
  var called = 0;
  for (var i = 0; i < c.students.length; i++) {
    if (c.students[i].calledThisRound) called++;
  }
  return { called: called, total: total, remaining: total - called };
}

function updateStatusPill() {
  var c = getCurrentClass();
  if (!el.statusPill) return;
  if (!c) {
    el.statusPill.textContent = "No class selected";
    return;
  }
  var rc = roundCounts(c);
  el.statusPill.textContent = c.name + " | Round: " + rc.called + "/" + rc.total + " | Remaining: " + rc.remaining;
}

function refreshPickControls() {
  var c = getCurrentClass();
  if (!c) {
    if (el.pickBtn) el.pickBtn.disabled = true;
    if (el.newRoundBtn) el.newRoundBtn.disabled = true;
    return;
  }

  var rc = roundCounts(c);
  if (rc.total === 0) {
    if (el.pickBtn) el.pickBtn.disabled = true;
    if (el.newRoundBtn) el.newRoundBtn.disabled = true;
    if (!pickedStudentId && el.pickedSub) el.pickedSub.textContent = "This class has no students yet.";
    return;
  }

  var roundComplete = (rc.remaining === 0);
  if (el.pickBtn) el.pickBtn.disabled = roundComplete;
  if (el.newRoundBtn) el.newRoundBtn.disabled = !roundComplete;

  if (roundComplete) {
    setPickedStudent(null);
    if (el.pickedSub) el.pickedSub.textContent = "Round complete - tap Start New Round when you're ready.";
  }
}

function startNewRound() {
  var c = getCurrentClass();
  if (!c) return;

  if (c.students.length === 0) {
    toast("No students in this class");
    return;
  }

  for (var i = 0; i < c.students.length; i++) {
    c.students[i].calledThisRound = false;
  }

  saveState();
  toast("New round started");
  updateStatusPill();
  refreshStudentList();
  refreshPickControls();
}

/* ---------- Pick / mark ---------- */

function setPickedStudent(student) {
  if (!student) {
    pickedStudentId = null;
    if (el.pickedName) el.pickedName.textContent = "-";
    if (el.pickedSub) el.pickedSub.textContent = "Pick a student to begin.";
    if (el.correctBtn) el.correctBtn.disabled = true;
    if (el.incorrectBtn) el.incorrectBtn.disabled = true;
    if (el.repickBtn) el.repickBtn.disabled = true;
    return;
  }

  pickedStudentId = student.id;
  if (el.pickedName) el.pickedName.textContent = student.name;

  var total = (student.correct || 0) + (student.incorrect || 0);
  var pct = (total === 0) ? "-" : (Math.round((student.correct / total) * 100) + "%");
  if (el.pickedSub) el.pickedSub.textContent = "Correct: " + (student.correct || 0) + " | Incorrect: " + (student.incorrect || 0) + " | Accuracy: " + pct;

  if (el.correctBtn) el.correctBtn.disabled = false;
  if (el.incorrectBtn) el.incorrectBtn.disabled = false;
  if (el.repickBtn) el.repickBtn.disabled = false;
}

function pickRandomStudent() {
  var c = getCurrentClass();
  if (!c) return;

  if (c.students.length === 0) {
    toast("No students in this class");
    setPickedStudent(null);
    refreshPickControls();
    return;
  }

  var eligible = [];
  for (var i = 0; i < c.students.length; i++) {
    if (!c.students[i].calledThisRound) eligible.push(c.students[i]);
  }

  if (eligible.length === 0) {
    refreshPickControls();
    toast("Round complete");
    return;
  }

  var idx = Math.floor(Math.random() * eligible.length);
  var s = eligible[idx];
  s.calledThisRound = true;

  saveState();
  setPickedStudent(s);
  refreshStudentList();
  updateStatusPill();
  refreshPickControls();
}

function markAnswer(isCorrect) {
  var c = getCurrentClass();
  if (!c || !pickedStudentId) return;

  var s = null;
  for (var i = 0; i < c.students.length; i++) {
    if (c.students[i].id === pickedStudentId) { s = c.students[i]; break; }
  }
  if (!s) return;

  if (isCorrect) s.correct = (s.correct || 0) + 1;
  else s.incorrect = (s.incorrect || 0) + 1;

  saveState();
  toast(isCorrect ? "Marked correct" : "Marked incorrect");
  setPickedStudent(s);
  refreshStudentList();
}

/* ---------- Manage classes ---------- */

function addClass(name) {
  var clean = normalizeName(name);
  if (!clean) return;

  state.classes.push({ id: uuid(), name: clean, students: [] });
  saveState();
  toast("Class added");
  refreshClassDropdowns();
  refreshStudentList();
  setPickedStudent(null);
}

function deleteCurrentClass() {
  var c = getCurrentClass();
  if (!c) return;

  if (!confirm('Delete class "' + c.name + '"? This removes all students & counts in it.')) return;

  state.classes = state.classes.filter(function (x) { return x.id !== c.id; });
  if (state.classes.length === 0) state = defaultState();

  currentClassId = state.classes[0].id;
  saveState();

  toast("Class deleted");
  refreshClassDropdowns();
  refreshStudentList();
  setPickedStudent(null);
}

function refreshClassDropdowns() {
  var options = "";
  for (var i = 0; i < state.classes.length; i++) {
    options += '<option value="' + state.classes[i].id + '">' + escapeHtml(state.classes[i].name) + "</option>";
  }
  if (el.classSelect) el.classSelect.innerHTML = options;
  if (el.manageClassSelect) el.manageClassSelect.innerHTML = options;

  if (!currentClassId || !getClassById(currentClassId)) {
    currentClassId = state.classes[0] ? state.classes[0].id : null;
  }

  if (currentClassId) {
    if (el.classSelect) el.classSelect.value = currentClassId;
    if (el.manageClassSelect) el.manageClassSelect.value = currentClassId;
  }

  updateStatusPill();
  refreshPickControls();
}

/* ---------- Manage students ---------- */

function addStudent(name) {
  var c = getCurrentClass();
  if (!c) return;

  var clean = normalizeName(name);
  if (!clean) return;

  var exists = c.students.some(function (s) { return s.name.toLowerCase() === clean.toLowerCase(); });
  if (exists) { toast("Student already exists"); return; }

  c.students.push({ id: uuid(), name: clean, correct: 0, incorrect: 0, calledThisRound: false });
  saveState();
  toast("Student added");
  refreshStudentList();
  updateStatusPill();
  refreshPickControls();
}

function deleteStudent(studentId) {
  var c = getCurrentClass();
  if (!c) return;

  var s = null;
  for (var i = 0; i < c.students.length; i++) {
    if (c.students[i].id === studentId) { s = c.students[i]; break; }
  }
  if (!s) return;

  if (!confirm('Delete "' + s.name + '"?')) return;

  c.students = c.students.filter(function (x) { return x.id !== studentId; });
  if (pickedStudentId === studentId) setPickedStudent(null);

  saveState();
  toast("Student deleted");
  refreshStudentList();
  updateStatusPill();
  refreshPickControls();
}

function editStudent(studentId) {
  var c = getCurrentClass();
  if (!c) return;

  var s = null;
  for (var i = 0; i < c.students.length; i++) {
    if (c.students[i].id === studentId) { s = c.students[i]; break; }
  }
  if (!s) return;

  var newName = prompt("Edit student name:", s.name);
  if (newName === null) return;

  var clean = normalizeName(newName);
  if (!clean) return;

  var exists = c.students.some(function (x) {
    return x.id !== s.id && x.name.toLowerCase() === clean.toLowerCase();
  });
  if (exists) { alert("Another student already has that name."); return; }

  s.name = clean;
  saveState();
  toast("Student updated");
  refreshStudentList();
  if (pickedStudentId === s.id) setPickedStudent(s);
}

function bulkImportStudents(text) {
  var c = getCurrentClass();
  if (!c) return;

  var names = parseBulkInput(text);
  if (names.length === 0) { toast("Nothing to import"); return; }

  var added = 0;
  for (var i = 0; i < names.length; i++) {
    var clean = normalizeName(names[i]);
    if (!clean) continue;

    var exists = c.students.some(function (s) { return s.name.toLowerCase() === clean.toLowerCase(); });
    if (exists) continue;

    c.students.push({ id: uuid(), name: clean, correct: 0, incorrect: 0, calledThisRound: false });
    added++;
  }

  saveState();
  toast("Imported " + added + " student" + (added === 1 ? "" : "s"));
  refreshStudentList();
  updateStatusPill();
  refreshPickControls();
}

/* ---------- Student list rendering ---------- */

function refreshStudentList() {
  var c = getCurrentClass();
  if (!el.studentList) return;
  el.studentList.innerHTML = "";
  if (!c) return;

  var q = String(el.searchInput && el.searchInput.value ? el.searchInput.value : "").toLowerCase().trim();

  var students = c.students
    .filter(function (s) { return !q || s.name.toLowerCase().indexOf(q) !== -1; })
    .slice()
    .sort(function (a, b) { return a.name.localeCompare(b.name); });

  if (students.length === 0) {
    el.studentList.innerHTML = '<div class="hint">No students match your search (or the class is empty).</div>';
    return;
  }

  var html = "";
  for (var i = 0; i < students.length; i++) {
    var s = students[i];
    var total = (s.correct || 0) + (s.incorrect || 0);
    var pct = (total === 0) ? "-" : (Math.round((s.correct / total) * 100) + "%");
    var rr = s.calledThisRound ? "Called this round" : "Not called yet";

    html += '<div class="item" data-id="' + s.id + '">';
    html +=   '<div class="meta">';
    html +=     '<div class="name">' + escapeHtml(s.name) + "</div>";
    html +=     '<div class="stats">C: ' + (s.correct || 0) + " | I: " + (s.incorrect || 0) + " | Acc: " + pct + " | " + rr + "</div>";
    html +=   "</div>";
    html +=   '<div class="actions">';
    html +=     '<button class="warn" data-action="edit">Edit</button>';
    html +=     '<button class="danger" data-action="delete">Delete</button>';
    html +=   "</div>";
    html += "</div>";
  }

  el.studentList.innerHTML = html;

  var buttons = el.studentList.querySelectorAll(".item button");
  for (var j = 0; j < buttons.length; j++) {
    buttons[j].addEventListener("click", function () {
      var btn = this;
      var item = btn.closest(".item");
      if (!item) return;
      var studentId = item.getAttribute("data-id");
      var action = btn.getAttribute("data-action");
      if (action === "delete") deleteStudent(studentId);
      if (action === "edit") editStudent(studentId);
    });
  }
}

/* ---------- Reset stats ---------- */

function resetStatsForClass() {
  var c = getCurrentClass();
  if (!c) return;

  if (!confirm('Reset all Correct/Incorrect counts for "' + c.name + '"?')) return;

  for (var i = 0; i < c.students.length; i++) {
    c.students[i].correct = 0;
    c.students[i].incorrect = 0;
  }

  saveState();
  toast("Stats reset");
  setPickedStudent(null);
  refreshStudentList();
}

/* ---------- Export ---------- */

function csvCell(value) {
  var s = String(value == null ? "" : value);
  if (/[,"\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

function dateStamp() {
  var d = new Date();
  function pad(n) { return String(n).padStart(2, "0"); }
  return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) + "_" + pad(d.getHours()) + pad(d.getMinutes());
}

function downloadFile(filename, content, mime) {
  var blob = new Blob([content], { type: mime });
  var url = URL.createObjectURL(blob);
  var a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  toast("Exported");
}

function exportCsv() {
  var rows = [];
  rows.push(["Class", "Student", "Correct", "Incorrect", "Total", "Accuracy"].join(","));

  for (var i = 0; i < state.classes.length; i++) {
    var c = state.classes[i];
    var students = c.students.slice().sort(function (a, b) { return a.name.localeCompare(b.name); });
    for (var j = 0; j < students.length; j++) {
      var s = students[j];
      var correct = s.correct || 0;
      var incorrect = s.incorrect || 0;
      var total = correct + incorrect;
      var accuracy = (total === 0) ? "" : (correct / total).toFixed(4);
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

  downloadFile("random-caller-export-" + dateStamp() + ".csv", rows.join("\n"), "text/csv;charset=utf-8");
}

function exportJson() {
  downloadFile("random-caller-backup-" + dateStamp() + ".json", JSON.stringify(state, null, 2), "application/json;charset=utf-8");
}

/* ---------- Wire up ---------- */

function wireEvents() {
  if (el.classSelect) {
    el.classSelect.addEventListener("change", function () {
      currentClassId = el.classSelect.value;
      if (el.manageClassSelect) el.manageClassSelect.value = currentClassId;
      saveState();
      updateStatusPill();
      setPickedStudent(null);
      refreshStudentList();
      refreshPickControls();
    });
  }

  if (el.manageClassSelect) {
    el.manageClassSelect.addEventListener("change", function () {
      currentClassId = el.manageClassSelect.value;
      if (el.classSelect) el.classSelect.value = currentClassId;
      saveState();
      updateStatusPill();
      setPickedStudent(null);
      refreshStudentList();
      refreshPickControls();
    });
  }

  if (el.pickBtn) el.pickBtn.addEventListener("click", pickRandomStudent);
  if (el.repickBtn) el.repickBtn.addEventListener("click", pickRandomStudent);

  if (el.correctBtn) el.correctBtn.addEventListener("click", function () { markAnswer(true); });
  if (el.incorrectBtn) el.incorrectBtn.addEventListener("click", function () { markAnswer(false); });

  if (el.newRoundBtn) el.newRoundBtn.addEventListener("click", startNewRound);

  if (el.addClassBtn) el.addClassBtn.addEventListener("click", function () {
    addClass(el.newClassName ? el.newClassName.value : "");
    if (el.newClassName) el.newClassName.value = "";
  });

  if (el.deleteClassBtn) el.deleteClassBtn.addEventListener("click", deleteCurrentClass);

  if (el.addStudentBtn) el.addStudentBtn.addEventListener("click", function () {
    addStudent(el.studentNameInput ? el.studentNameInput.value : "");
    if (el.studentNameInput) el.studentNameInput.value = "";
  });

  if (el.studentNameInput) {
    el.studentNameInput.addEventListener("keydown", function (e) {
      if (e.key === "Enter") {
        e.preventDefault();
        if (el.addStudentBtn) el.addStudentBtn.click();
      }
    });
  }

  if (el.bulkImportBtn) el.bulkImportBtn.addEventListener("click", function () {
    bulkImportStudents(el.bulkInput ? el.bulkInput.value : "");
  });

  if (el.clearBulkBtn) el.clearBulkBtn.addEventListener("click", function () {
    if (el.bulkInput) el.bulkInput.value = "";
    toast("Cleared");
  });

  if (el.searchInput) el.searchInput.addEventListener("input", refreshStudentList);

  if (el.resetStatsBtn) el.resetStatsBtn.addEventListener("click", resetStatsForClass);

  if (el.exportCsvBtn) el.exportCsvBtn.addEventListener("click", exportCsv);
  if (el.exportJsonBtn) el.exportJsonBtn.addEventListener("click", exportJson);
}

function init() {
  // pick first class by default
  currentClassId = (state.classes[0] && state.classes[0].id) ? state.classes[0].id : null;

  refreshClassDropdowns();
  refreshStudentList();
  setPickedStudent(null);

  wireEvents();

  updateStatusPill();
  refreshPickControls();
}

document.addEventListener("DOMContentLoaded", init);
