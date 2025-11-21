// ==========================================
// 1. КОНФІГУРАЦІЯ ТА РЕЄСТР (CORE)
// ==========================================

// ГОЛОВНИЙ РЕЄСТР МОДУЛІВ: Додавайте сюди нові модулі, і вони з'являться всюди.
var APP_MODULES = [
  { id: 'grading',     file: 'grading',     icon: 'edit_note',       title: 'Журнал',      desc: 'Оцінювання учнів' },
  { id: 'schedule',    file: 'schedule',    icon: 'calendar_today',  title: 'Розклад',     desc: 'Перегляд занять' },
  { id: 'students',    file: 'students',    icon: 'group',           title: 'Студенти',    desc: 'База даних' },
  { id: 'load',        file: 'load',        icon: 'pie_chart',       title: 'Навантаження', desc: 'Статистика' },
  { id: 'admin',       file: 'admin',       icon: 'admin_panel_settings', title: 'Адмін Панель', desc: 'Налаштування', role: 'admin' }
];

// ID ТАБЛИЦЬ (З властивостей скрипта)
var TEACHER_SHEET_ID = PropertiesService.getScriptProperties().getProperty('Teachers');
var AUTH_SHEET_ID    = PropertiesService.getScriptProperties().getProperty('auth');
// Ви використовуєте 'Roles' з великої літери, тому залишаємо так:
var ROLE_SHEET_ID    = PropertiesService.getScriptProperties().getProperty('Roles'); 

var AUTH_TTL_HOURS   = 168; // 7 днів

// ==========================================
// 2. СИСТЕМНІ ФУНКЦІЇ
// ==========================================

function doGet() {
  var template = HtmlService.createTemplateFromFile('Index');
  // Передаємо конфігурацію модулів на фронтенд
  template.modules = APP_MODULES; 
  return template.evaluate()
      .setTitle('Teacher System')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

// API для отримання конфігурації на клієнті
function apiGetModuleConfig() {
  return APP_MODULES;
}

// ==========================================
// 3. АВТОРИЗАЦІЯ ТА ПРАВА (RBAC)
// ==========================================

function apiLogin(loginInput, passwordInput) {
  var normalizedLogin = _normalizeLogin(loginInput);
  if (!normalizedLogin) return {success: false, msg: "Введіть логін"};

  var ssAuth = SpreadsheetApp.openById(AUTH_SHEET_ID);
  var sheetAuth = ssAuth.getSheetByName('Аркуш1'); 
  var dataAuth = sheetAuth.getDataRange().getValues();
  
  // 1. Зчитуємо дані користувачів (де є пошта/телефон)
  var ssTeachers = SpreadsheetApp.openById(TEACHER_SHEET_ID); 
  var sheetTeachers = ssTeachers.getSheetByName('Аркуш1');
  var dataTeachers = sheetTeachers.getDataRange().getValues();

  var userRowIndexInAuth = -1;
  var userId = null;
  var storedHash = "";
  var role = "";

  // 2. Знаходимо користувача за email/phone в таблиці Teachers
  // Припускаємо, що: Стовпець A - ID, C - Mail, D - Phone
  for (var i = 1; i < dataTeachers.length; i++) {
    var teacherId = dataTeachers[i][0];
    var email = _normalizeLogin(dataTeachers[i][2]); // Mail - стовпець C (індекс 2)
    var phone = _normalizeLogin(dataTeachers[i][3]); // Phone - стовпець D (індекс 3)
    
    if (teacherId && (normalizedLogin === email || normalizedLogin === phone)) {
      userId = teacherId;
      break;
    }
  }

  if (!userId) return {success: false, msg: "Користувача не знайдено"};

  // 3. Знаходимо хеш та роль за знайденим ID в таблиці Auth
  // Припускаємо, що: Стовпець A - ID, B - Hash, E - Role
  for (var i = 1; i < dataAuth.length; i++) {
    if (dataAuth[i][0] == userId) {
      userRowIndexInAuth = i + 1;
      storedHash = dataAuth[i][1]; 
      role = dataAuth[i][4] ? dataAuth[i][4].toString() : ""; 
      break;
    }
  }
  
  if (userRowIndexInAuth === -1) return {success: false, msg: "Дані авторизації відсутні"};
  if (_hash(passwordInput) !== storedHash) return {success: false, msg: "Невірний пароль"};

  // 4. Оновлюємо токен
  var token = Utilities.getUuid();
  var expireDate = new Date(); 
  expireDate.setHours(expireDate.getHours() + AUTH_TTL_HOURS);
  
  sheetAuth.getRange(userRowIndexInAuth, 3).setValue(token); 
  sheetAuth.getRange(userRowIndexInAuth, 4).setValue(expireDate.toISOString());

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

// Логіка збору прав (Роль + Індивідуальні ID)
function _getPermissions(userId, roleName) {
  if (!roleName || roleName.toLowerCase() === 'admin') return ['*'];
  if (!ROLE_SHEET_ID) return [];

  var ss = SpreadsheetApp.openById(ROLE_SHEET_ID);
  var sheet = ss.getSheetByName('Аркуш1');
  var data = sheet.getDataRange().getValues();
  var permissions = [];

  // 1. Права Ролі
  for (var i = 0; i < data.length; i++) {
    if (data[i][0].toString().toLowerCase() == roleName.toLowerCase()) {
      try { permissions = permissions.concat(JSON.parse(data[i][1])); } catch (e) {}
    }
  }
  // 2. Права Індивідуальні (по ID)
  for (var i = 0; i < data.length; i++) {
    if (data[i][0].toString() == userId.toString()) {
      try { permissions = permissions.concat(JSON.parse(data[i][1])); } catch (e) {}
    }
  }
  return [...new Set(permissions)];
}

// Динамічний реєстр прав для Адмінки
function apiGetSystemCapabilities() {
  var caps = [];
  
  // 1. Автоматично додаємо модулі як права
  APP_MODULES.forEach(m => {
    caps.push({ key: m.id, category: 'Модулі', label: m.title });
  });

  // 2. Додаємо специфічні дії
  caps.push(
    { key: 'can_edit_marks', category: 'Дії', label: 'Редагування оцінок' },
    { key: 'can_delete_marks', category: 'Дії', label: 'Видалення оцінок' },
    { key: 'action_access_ctrl', category: 'Адмінка', label: 'Керування Доступом' }
  );
  
  return caps;
}

// ==========================================
// 4. API МОДУЛІВ
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

// ==========================================
// 5. HELPERS (ЗМІНЕНО)
// ==========================================

// ⚠️ ВАЖЛИВО: Змініть цей рядок на свій унікальний набір символів!
// Це зробить ваші паролі захищеними навіть якщо базу вкрадуть.
var GLOBAL_SALT = "My_SuP3r_S3cr3t_S@lt_2025_!#ChangeMe"; 

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

// ОНОВЛЕНА ФУНКЦІЯ ХЕШУВАННЯ
function _hash(s) { 
  // Додаємо "сіль" до пароля перед хешуванням
  var payload = s.toString() + GLOBAL_SALT;
  
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, payload)
    .map(b=>(b<0?b+256:b).toString(16).padStart(2,'0')).join(''); 
}

// ДОПОМІЖНА ФУНКЦІЯ ДЛЯ ОТРИМАННЯ НОВИХ ХЕШІВ
// Запустіть її вручну в редакторі, щоб дізнатися, що вписати в таблицю
function generateNewHashHelper() { 
  var password = "admin"; // <-- Впишіть сюди пароль користувача
  Logger.log("НОВИЙ ХЕШ для '" + password + "': " + _hash(password)); 
}

// --- НОРМАЛІЗАЦІЯ ТЕЛЕФОНУ/ЛОГІНУ ---
function _normalizeLogin(login) {
  if (!login) return null;
  var cleaned = login.toString().trim();
  
  if (cleaned.includes('@')) {
    // Якщо це схоже на пошту
    return cleaned.toLowerCase();
  }
  
  // Якщо це телефон: видаляємо всі нецифрові символи
  cleaned = cleaned.replace(/\D/g, ''); 

  // Якщо телефон починається з міжнародного коду України (380...)
  if (cleaned.length === 12 && cleaned.startsWith('380')) {
    return cleaned;
  } 
  // Якщо телефон починається з 0 (наприклад, 0991234567)
  else if (cleaned.length === 10 && cleaned.startsWith('0')) {
    return '38' + cleaned;
  }
  
  // В інших випадках повертаємо як є (може бути ID або інший формат)
  return cleaned;
}