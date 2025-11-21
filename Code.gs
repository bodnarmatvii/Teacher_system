var TEACHER_SHEET_ID = PropertiesService.getScriptProperties().getProperty('Teachers');
var AUTH_SHEET_ID    = PropertiesService.getScriptProperties().getProperty('auth');
var ROLE_SHEET_ID    = PropertiesService.getScriptProperties().getProperty('role');
var AUTH_TTL_HOURS   = 168; 

function doGet() {
  return HtmlService.createTemplateFromFile('Index')
      .evaluate().setTitle('Teacher System').setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

// 1. СПИСОК ДЛЯ ВХОДУ (Виправлено помилку з пустими рядками)
function getLoginList() {
  var ss = SpreadsheetApp.openById(TEACHER_SHEET_ID);
  var sheet = ss.getSheetByName('Аркуш1'); 
  var lastRow = sheet.getLastRow();
  
  // Якщо таблиця пуста (тільки заголовок або менше), повертаємо пустий список, а не помилку
  if (lastRow < 2) return []; 
  
  var data = sheet.getRange(2, 1, lastRow - 1, 2).getValues();
  return data.filter(r => r[0] !== "").map(r => ({id: r[0], name: r[1]}));
}

// 2. ЛОГІН
function apiLogin(userId, passwordInput) {
  var ss = SpreadsheetApp.openById(AUTH_SHEET_ID);
  var sheet = ss.getSheetByName('Аркуш1'); 
  var data = sheet.getDataRange().getValues();
  
  var userRowIndex = -1, storedHash = "", role = "";

  for (var i = 1; i < data.length; i++) {
    if (data[i][0] == userId) {
      userRowIndex = i + 1;
      storedHash = data[i][1];
      role = data[i][4] ? data[i][4].toString() : ""; 
      break;
    }
  }

  if (userRowIndex === -1) return {success: false, msg: "ID не знайдено"};
  if (_hash(passwordInput) !== storedHash) return {success: false, msg: "Невірний пароль"};

  var token = Utilities.getUuid();
  var expireDate = new Date(); expireDate.setHours(expireDate.getHours() + AUTH_TTL_HOURS);
  sheet.getRange(userRowIndex, 3).setValue(token); 
  sheet.getRange(userRowIndex, 4).setValue(expireDate.toISOString());

  var userName = _getUserNameById(userId);
  var permissions = _getPermissions(userId, role);

  return { success: true, token: token, user: { id: userId, name: userName, role: role, permissions: permissions } };
}

// 3. ПЕРЕВІРКА СЕСІЇ
function apiMe(token) {
  if (!token) return {success: false};
  var ss = SpreadsheetApp.openById(AUTH_SHEET_ID);
  var sheet = ss.getSheetByName('Аркуш1');
  var data = sheet.getDataRange().getValues();

  for (var i = 1; i < data.length; i++) {
    if (data[i][2] === token) {
      if (new Date() > new Date(data[i][3])) return {success: false, msg: "Сесія вийшла"};
      var userId = data[i][0];
      var role = data[i][4] ? data[i][4].toString() : ""; 
      var permissions = _getPermissions(userId, role);
      return { success: true, user: { id: userId, name: _getUserNameById(userId), role: role, permissions: permissions } };
    }
  }
  return {success: false};
}

// 4. ЛОГИ
function apiSaveLog(token, grade, topic, studentName) {
  var auth = apiMe(token);
  if (!auth.success) return "Помилка авторизації";
  var ss = SpreadsheetApp.openById(TEACHER_SHEET_ID);
  var sheet = ss.getSheetByName('Logs');
  if (!sheet) { sheet = ss.insertSheet('Logs'); sheet.appendRow(['Дата', 'Час', 'Викладач', 'Учень', 'Оцінка', 'Тема']); }
  sheet.appendRow([new Date(), new Date().toLocaleTimeString(), auth.user.name, studentName, grade, topic]);
  return "✅ Збережено";
}

// 5. РОБОТА З КЛАСАМИ (Для grading.html)
function apiGetClasses() {
  var ss = SpreadsheetApp.openById(TEACHER_SHEET_ID);
  var sheet = ss.getSheetByName('Students');
  if (!sheet) return [];
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  var data = sheet.getRange(2, 3, lastRow - 1, 1).getValues(); // Колонка C (Клас)
  var classes = [...new Set(data.flat().filter(String))];
  return classes.sort();
}

function apiGetStudentsByClass(className) {
  var ss = SpreadsheetApp.openById(TEACHER_SHEET_ID);
  var sheet = ss.getSheetByName('Students');
  var data = sheet.getDataRange().getValues();
  var students = [];
  for (var i = 1; i < data.length; i++) {
    if (data[i][2] == className) students.push({ id: data[i][0], name: data[i][1] });
  }
  return students;
}

// --- АДМІНКА ---
function apiGetSystemCapabilities() {
  return [
    { key: 'grading', category: 'Модулі', label: 'Журнал' },
    { key: 'schedule', category: 'Модулі', label: 'Розклад' },
    { key: 'students', category: 'Модулі', label: 'Студенти' },
    { key: 'load', category: 'Модулі', label: 'Навантаження' },
    { key: 'admin_panel', category: 'Модулі', label: 'Адмін-Панель' }
  ];
}
function apiGetRolesConfig() {
  var ss = SpreadsheetApp.openById(ROLE_SHEET_ID);
  var data = ss.getSheetByName('Аркуш1').getDataRange().getValues();
  return data.map(r => { try { return {name: r[0], permissions: JSON.parse(r[1])}; } catch(e) { return {name: r[0], permissions: []}; } });
}
function apiSaveRoleConfig(name, perms) {
  var ss = SpreadsheetApp.openById(ROLE_SHEET_ID); var sheet = ss.getSheetByName('Аркуш1');
  var data = sheet.getDataRange().getValues(); var json = JSON.stringify(perms);
  for(var i=0; i<data.length; i++) { if(data[i][0]==name) { sheet.getRange(i+1, 2).setValue(json); return {success:true, msg:"Оновлено"}; } }
  sheet.appendRow([name, json]); return {success:true, msg:"Створено"};
}
function apiGetUsers() {
  var ss = SpreadsheetApp.openById(AUTH_SHEET_ID); var data = ss.getSheetByName('Аркуш1').getDataRange().getValues();
  var nameMap = _getNameMap();
  return data.slice(1).map(r => ({id: r[0], role: r[4], name: nameMap[r[0]] || 'ID '+r[0]}));
}
function apiUpdateUserRole(id, role) {
  var ss = SpreadsheetApp.openById(AUTH_SHEET_ID); var sheet = ss.getSheetByName('Аркуш1');
  var data = sheet.getDataRange().getValues();
  for(var i=1; i<data.length; i++) { if(data[i][0]==id) { sheet.getRange(i+1, 5).setValue(role); return {success:true, msg:"Роль змінено"}; } }
}

// --- HELPERS ---
function _getUserNameById(id) {
  var ss = SpreadsheetApp.openById(TEACHER_SHEET_ID); var sheet = ss.getSheetByName('Аркуш1');
  var data = sheet.getDataRange().getValues();
  for(var i=1; i<data.length; i++) if(data[i][0]==id) return data[i][1];
  return "Unknown";
}
function _getNameMap() {
  var ss = SpreadsheetApp.openById(TEACHER_SHEET_ID); var data = ss.getSheetByName('Аркуш1').getDataRange().getValues();
  var map={}; for(var i=1; i<data.length; i++) map[data[i][0]] = data[i][1]; return map;
}
function _getPermissions(userId, role) {
  if(role==='admin') return ['*']; if(!ROLE_SHEET_ID) return [];
  var ss = SpreadsheetApp.openById(ROLE_SHEET_ID); var data = ss.getSheetByName('Аркуш1').getDataRange().getValues();
  var perms=[];
  data.forEach(r => { if(r[0]==role || r[0]==userId) { try{perms=perms.concat(JSON.parse(r[1]))}catch(e){} } });
  return [...new Set(perms)];
}
function _hash(s) { return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s.toString()).map(b=>(b<0?b+256:b).toString(16).padStart(2,'0')).join(''); }
function generateHashForTable() { Logger.log(_hash("admin000admin")); }