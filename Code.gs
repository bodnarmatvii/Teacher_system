// ==========================================
// 1. CONFIGURATION & REGISTRY (CORE)
// ==========================================

// MASTER REGISTRY: Add new modules here, and they will appear in the Menu and Admin Panel automatically.
var APP_MODULES = [
  { id: 'grading',     file: 'grading',     icon: 'edit_note',       title: 'Журнал',      desc: 'Оцінювання учнів' },
  { id: 'schedule',    file: 'schedule',    icon: 'calendar_today',  title: 'Розклад',     desc: 'Перегляд занять' },
  { id: 'students',    file: 'students',    icon: 'group',           title: 'Студенти',    desc: 'База даних' },
  { id: 'load',        file: 'load',        icon: 'pie_chart',       title: 'Навантаження', desc: 'Статистика' },
  { id: 'admin',       file: 'admin',       icon: 'admin_panel_settings', title: 'Адмін Панель', desc: 'Налаштування', role: 'admin' }
];

// DATABASE IDs (From Script Properties)
var TEACHER_SHEET_ID = PropertiesService.getScriptProperties().getProperty('Teachers');
var AUTH_SHEET_ID    = PropertiesService.getScriptProperties().getProperty('auth');
// Updated to 'Roles' as per your request
var ROLE_SHEET_ID    = PropertiesService.getScriptProperties().getProperty('Roles'); 

var AUTH_TTL_HOURS   = 168; // 7 days

// ==========================================
// 2. SYSTEM FUNCTIONS
// ==========================================

function doGet() {
  var template = HtmlService.createTemplateFromFile('Index');
  // Pass the module config to the frontend
  template.modules = APP_MODULES; 
  return template.evaluate()
      .setTitle('Teacher System')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

// API to send config to Dashboard/Admin
function apiGetModuleConfig() {
  return APP_MODULES;
}

// ==========================================
// 3. AUTHENTICATION & PERMISSIONS (RBAC)
// ==========================================

function apiLogin(userId, passwordInput) {
  var ss = SpreadsheetApp.openById(AUTH_SHEET_ID);
  var sheet = ss.getSheetByName('Аркуш1'); 
  var data = sheet.getDataRange().getValues();
  
  var userRowIndex = -1;
  var storedHash = "", role = "";

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
  var expireDate = new Date(); 
  expireDate.setHours(expireDate.getHours() + AUTH_TTL_HOURS);
  
  sheet.getRange(userRowIndex, 3).setValue(token); 
  sheet.getRange(userRowIndex, 4).setValue(expireDate.toISOString());

  var userName = _getUserNameById(userId);
  var permissions = _getPermissions(userId, role); 

  return { success: true, token: token, user: { id: userId, name: userName, role: role, permissions: permissions } };
}

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
      var userName = _getUserNameById(userId);
      var permissions = _getPermissions(userId, role);
      
      return { success: true, user: { id: userId, name: userName, role: role, permissions: permissions } };
    }
  }
  return {success: false, msg: "Токен не знайдено"};
}

// Core Permission Logic (Role + Individual ID)
function _getPermissions(userId, roleName) {
  if (!roleName || roleName.toLowerCase() === 'admin') return ['*'];
  if (!ROLE_SHEET_ID) return [];

  var ss = SpreadsheetApp.openById(ROLE_SHEET_ID);
  var sheet = ss.getSheetByName('Аркуш1');
  var data = sheet.getDataRange().getValues();
  var permissions = [];

  // 1. Role Permissions
  for (var i = 0; i < data.length; i++) {
    if (data[i][0].toString().toLowerCase() == roleName.toLowerCase()) {
      try { permissions = permissions.concat(JSON.parse(data[i][1])); } catch (e) {}
    }
  }
  // 2. Individual ID Permissions
  for (var i = 0; i < data.length; i++) {
    if (data[i][0].toString() == userId.toString()) {
      try { permissions = permissions.concat(JSON.parse(data[i][1])); } catch (e) {}
    }
  }
  return [...new Set(permissions)];
}

// Dynamic Capabilities Registry for Admin Panel
function apiGetSystemCapabilities() {
  var caps = [];
  
  // 1. Auto-generate capabilities from Modules
  APP_MODULES.forEach(m => {
    caps.push({ key: m.id, category: 'Модулі', label: m.title });
  });

  // 2. Add granular action permissions
  caps.push(
    { key: 'can_edit_marks', category: 'Дії', label: 'Редагування оцінок' },
    { key: 'can_delete_marks', category: 'Дії', label: 'Видалення оцінок' },
    { key: 'action_access_ctrl', category: 'Адмінка', label: 'Керування Доступом' }
  );
  
  return caps;
}

// ==========================================
// 4. MODULE APIs
// ==========================================

// --- LOGS & GRADING ---
function apiSaveLog(token, grade, topic, studentName) {
  var auth = apiMe(token);
  if (!auth.success) return "Помилка авторизації";
  
  var ss = SpreadsheetApp.openById(TEACHER_SHEET_ID);
  var sheet = ss.getSheetByName('Logs');
  if (!sheet) { sheet = ss.insertSheet('Logs'); sheet.appendRow(['Дата', 'Час', 'Викладач', 'Учень', 'Оцінка', 'Тема']); }
  
  var d = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "dd.MM.yyyy");
  var t = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "HH:mm");
  
  sheet.appendRow([d, t, auth.user.name, studentName, grade, topic]);
  return "✅ Збережено";
}

// --- STUDENTS & CLASSES ---
function apiGetClasses() {
  var ss = SpreadsheetApp.openById(TEACHER_SHEET_ID);
  var sheet = ss.getSheetByName('Students');
  if (!sheet) return [];
  
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  
  var data = sheet.getRange(2, 3, lastRow - 1, 1).getValues(); // Col C (Class)
  var classes = [...new Set(data.flat().filter(String))];
  return classes.sort();
}

function apiGetStudentsByClass(className) {
  var ss = SpreadsheetApp.openById(TEACHER_SHEET_ID);
  var sheet = ss.getSheetByName('Students');
  var data = sheet.getDataRange().getValues();
  
  var students = [];
  for (var i = 1; i < data.length; i++) {
    if (data[i][2] == className) {
      students.push({ id: data[i][0], name: data[i][1] });
    }
  }
  return students;
}

// --- ADMIN PANEL APIs ---
function apiGetUsers() {
  var ss = SpreadsheetApp.openById(AUTH_SHEET_ID); 
  var sheet = ss.getSheetByName('Аркуш1');
  var data = sheet.getDataRange().getValues();
  var nameMap = _getNameMap();
  
  var users = [];
  for (var i = 1; i < data.length; i++) {
    var id = data[i][0];
    if(!id) continue;
    users.push({ id: id, role: data[i][4], name: nameMap[id] || "ID " + id });
  }
  return users;
}

function apiGetRolesConfig() {
  var ss = SpreadsheetApp.openById(ROLE_SHEET_ID); 
  var sheet = ss.getSheetByName('Аркуш1');
  var data = sheet.getDataRange().getValues();
  
  var roles = [];
  for (var i = 0; i < data.length; i++) {
    var rName = data[i][0];
    if(!rName) continue;
    try { roles.push({name: rName, permissions: JSON.parse(data[i][1])}); } 
    catch(e) { roles.push({name: rName, permissions: []}); }
  }
  return roles;
}

function apiSaveRoleConfig(name, perms) {
  var ss = SpreadsheetApp.openById(ROLE_SHEET_ID); 
  var sheet = ss.getSheetByName('Аркуш1');
  var data = sheet.getDataRange().getValues(); 
  var json = JSON.stringify(perms);
  
  for(var i=0; i<data.length; i++) { 
    if(data[i][0] == name) { 
      sheet.getRange(i+1, 2).setValue(json); 
      return {success:true, msg:"Оновлено"}; 
    } 
  }
  sheet.appendRow([name, json]); 
  return {success:true, msg:"Створено"};
}

function apiUpdateUserRole(id, role) {
  var ss = SpreadsheetApp.openById(AUTH_SHEET_ID); 
  var sheet = ss.getSheetByName('Аркуш1');
  var data = sheet.getDataRange().getValues();
  
  for(var i=1; i<data.length; i++) { 
    if(data[i][0] == id) { 
      sheet.getRange(i+1, 5).setValue(role); 
      return {success:true, msg:"Роль змінено"}; 
    } 
  }
}

// ==========================================
// 5. HELPERS
// ==========================================

function getLoginList() {
  var ss = SpreadsheetApp.openById(TEACHER_SHEET_ID); 
  var sheet = ss.getSheetByName('Аркуш1'); 
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  var data = sheet.getRange(2, 1, lastRow - 1, 2).getValues();
  return data.filter(r => r[0] !== "").map(r => ({id: r[0], name: r[1]}));
}

function _getUserNameById(id) {
  var ss = SpreadsheetApp.openById(TEACHER_SHEET_ID); 
  var sheet = ss.getSheetByName('Аркуш1');
  var data = sheet.getDataRange().getValues();
  for(var i=1; i<data.length; i++) if(data[i][0]==id) return data[i][1];
  return "Unknown";
}

function _getNameMap() {
  var ss = SpreadsheetApp.openById(TEACHER_SHEET_ID); 
  var sheet = ss.getSheetByName('Аркуш1');
  var data = sheet.getRange(2, 1, sheet.getLastRow()-1, 2).getValues(); 
  var map={}; 
  data.forEach(r => map[r[0]] = r[1]); 
  return map;
}

function _hash(s) { 
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s.toString())
    .map(b=>(b<0?b+256:b).toString(16).padStart(2,'0')).join(''); 
}

function generateHashForTable() { 
  Logger.log(_hash("admin000admin")); 
}