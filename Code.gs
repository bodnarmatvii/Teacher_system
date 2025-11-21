// ==========================================
// 1. КОНФІГУРАЦІЯ (ЯДРО)
// ==========================================
var TEACHER_SHEET_ID = PropertiesService.getScriptProperties().getProperty('Teachers');
var AUTH_SHEET_ID    = PropertiesService.getScriptProperties().getProperty('auth');
var ROLE_SHEET_ID    = PropertiesService.getScriptProperties().getProperty('role');
var AUTH_TTL_HOURS   = 168; 

// --- ГОЛОВНИЙ РЕЄСТР МОДУЛІВ І ПРАВ ---
// Це "паспорт" вашої системи. Додавайте сюди нові модулі та кнопки.
function apiGetSystemConfig() {
  return {
    // Список модулів (файлів), які підвантажуються
    modules: [
      { id: 'dashboard', file: 'dashboard', title: 'Головна' }, // Базовий модуль
      { id: 'admin',     file: 'admin',     title: 'Адмін Панель' },
      { id: 'grading',   file: 'grading',   title: 'Журнал' },
      { id: 'schedule',  file: 'schedule',  title: 'Розклад' }
    ],
    
    // Список ПРАВ (Що можна заборонити/дозволити в Адмінці)
    capabilities: [
      { key: 'module_grading',   category: 'Доступ до модулів', label: 'Вхід у Журнал' },
      { key: 'module_schedule',  category: 'Доступ до модулів', label: 'Вхід у Розклад' },
      { key: 'module_admin',     category: 'Доступ до модулів', label: 'Вхід в Адмінку' },
      
      { key: 'action_edit_marks',   category: 'Кнопки Журналу', label: 'Редагувати оцінки' },
      { key: 'action_delete_marks', category: 'Кнопки Журналу', label: 'Видаляти оцінки' },
      { key: 'action_access_ctrl',  category: 'Кнопки Адмінки', label: 'Керування Доступом' }
    ]
  };
}

function doGet() {
  return HtmlService.createTemplateFromFile('Index')
      .evaluate().setTitle('Teacher System Core')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

// ==========================================
// 2. АВТОРИЗАЦІЯ ТА ПРАВА
// ==========================================

function apiLogin(userId, pass) {
  var ss = SpreadsheetApp.openById(AUTH_SHEET_ID);
  var data = ss.getSheetByName('Аркуш1').getDataRange().getValues();
  
  var user = null, rowIndex = -1;
  
  for (var i = 1; i < data.length; i++) {
    if (data[i][0] == userId) {
      if (_hash(pass) === data[i][1]) {
        user = { id: userId, role: data[i][4] || 'user' };
        rowIndex = i + 1;
      }
      break;
    }
  }
  
  if (!user) return { success: false, msg: 'Невірні дані' };

  // Генеруємо токен
  var token = Utilities.getUuid();
  var exp = new Date(); exp.setHours(exp.getHours() + AUTH_TTL_HOURS);
  ss.getSheetByName('Аркуш1').getRange(rowIndex, 3).setValue(token);
  ss.getSheetByName('Аркуш1').getRange(rowIndex, 4).setValue(exp.toISOString());

  user.name = _getUserName(userId);
  user.permissions = _getPermissions(user.id, user.role);

  return { success: true, token: token, user: user, config: apiGetSystemConfig() };
}

function apiMe(token) {
  if(!token) return { success: false };
  var ss = SpreadsheetApp.openById(AUTH_SHEET_ID);
  var data = ss.getSheetByName('Аркуш1').getDataRange().getValues();

  for (var i = 1; i < data.length; i++) {
    if (data[i][2] === token) {
      if (new Date() > new Date(data[i][3])) return { success: false, msg: 'Сесія вийшла' };
      
      var user = {
        id: data[i][0],
        role: data[i][4] || 'user',
        name: _getUserName(data[i][0])
      };
      user.permissions = _getPermissions(user.id, user.role);
      
      return { success: true, user: user, config: apiGetSystemConfig() };
    }
  }
  return { success: false };
}

// Функція злиття прав (Роль + ID)
function _getPermissions(userId, role) {
  if (role === 'admin') return ['*']; // Адмін має все
  if (!ROLE_SHEET_ID) return [];

  var ss = SpreadsheetApp.openById(ROLE_SHEET_ID);
  var data = ss.getSheetByName('Аркуш1').getDataRange().getValues();
  var perms = [];

  // Шукаємо права для Ролі та для ID
  data.forEach(row => {
    if (row[0] == role || row[0] == userId) {
      try { perms = perms.concat(JSON.parse(row[1])); } catch(e){}
    }
  });
  return [...new Set(perms)];
}

// ==========================================
// 3. API АДМІНКИ (CRUD)
// ==========================================
function apiGetUsers() {
  var authData = SpreadsheetApp.openById(AUTH_SHEET_ID).getDataRange().getValues();
  var nameMap = _getNameMap();
  return authData.slice(1).map(r => ({ id: r[0], role: r[4], name: nameMap[r[0]] || 'ID '+r[0] }));
}

function apiGetRoles() {
  var data = SpreadsheetApp.openById(ROLE_SHEET_ID).getDataRange().getValues();
  return data.map(r => {
    try { return { name: r[0], perms: JSON.parse(r[1]) }; } catch(e) { return { name: r[0], perms: [] }; }
  });
}

function apiSaveRole(name, perms) {
  var ss = SpreadsheetApp.openById(ROLE_SHEET_ID);
  var sheet = ss.getSheetByName('Аркуш1');
  var data = sheet.getDataRange().getValues();
  var json = JSON.stringify(perms);

  for (var i = 0; i < data.length; i++) {
    if (data[i][0] == name) {
      sheet.getRange(i+1, 2).setValue(json);
      return { success: true };
    }
  }
  sheet.appendRow([name, json]);
  return { success: true };
}

function apiUpdateUserRole(id, role) {
  var sheet = SpreadsheetApp.openById(AUTH_SHEET_ID).getSheetByName('Аркуш1');
  var data = sheet.getDataRange().getValues();
  for(var i=1; i<data.length; i++) {
    if(data[i][0] == id) {
      sheet.getRange(i+1, 5).setValue(role);
      return { success: true };
    }
  }
}

// --- HELPERS ---
function _getUserName(id) {
  var data = SpreadsheetApp.openById(TEACHER_SHEET_ID).getDataRange().getValues();
  for(var i=1; i<data.length; i++) if(data[i][0] == id) return data[i][1];
  return "Unknown";
}
function _getNameMap() {
  var data = SpreadsheetApp.openById(TEACHER_SHEET_ID).getDataRange().getValues();
  var map = {}; data.slice(1).forEach(r => map[r[0]] = r[1]); return map;
}
function _hash(s) { return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s).map(b=>(b<0?b+256:b).toString(16).padStart(2,'0')).join(''); }