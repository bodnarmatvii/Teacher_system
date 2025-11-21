// ==========================================
// НАЛАШТУВАННЯ (CONFIG)
// ==========================================
// Переконайтеся, що у Властивостях скрипта (Script Properties) задані ID: 'Teachers', 'auth', 'role'
var TEACHER_SHEET_ID = PropertiesService.getScriptProperties().getProperty('Teachers');
var AUTH_SHEET_ID    = PropertiesService.getScriptProperties().getProperty('auth');
var ROLE_SHEET_ID    = PropertiesService.getScriptProperties().getProperty('role');

var AUTH_TTL_HOURS = 168; // 7 днів

function doGet() {
  return HtmlService.createTemplateFromFile('Index')
      .evaluate()
      .setTitle('EduVision System')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

// ==========================================
// 1. АВТОРИЗАЦІЯ ТА СЕСІЇ
// ==========================================

// Отримання списку для вибору при вході
function getLoginList() {
  var ss = SpreadsheetApp.openById(TEACHER_SHEET_ID);
  var sheet = ss.getSheetByName('Аркуш1'); 
  // A=ID, B=Name
  var data = sheet.getRange(2, 1, sheet.getLastRow()-1, 2).getValues();
  return data.filter(r => r[0] !== "").map(r => ({id: r[0], name: r[1]}));
}

// Логін (вхід)
function apiLogin(userId, passwordInput) {
  var ss = SpreadsheetApp.openById(AUTH_SHEET_ID);
  var sheet = ss.getSheetByName('Аркуш1'); 
  var data = sheet.getDataRange().getValues();
  
  var userRowIndex = -1;
  var storedHash = "";
  var role = "";

  // Шукаємо користувача в Auth
  for (var i = 1; i < data.length; i++) {
    if (data[i][0] == userId) {
      userRowIndex = i + 1;
      storedHash = data[i][1]; // Col B
      role = data[i][4] ? data[i][4].toString() : ""; // Col E (Role)
      break;
    }
  }

  if (userRowIndex === -1) return {success: false, msg: "ID не знайдено"};
  
  var inputHash = _hash(passwordInput);
  if (inputHash !== storedHash) return {success: false, msg: "Невірний пароль"};

  // Генеруємо сесію
  var token = Utilities.getUuid();
  var expireDate = new Date();
  expireDate.setHours(expireDate.getHours() + AUTH_TTL_HOURS);
  
  // Зберігаємо токен (C) і час (D)
  sheet.getRange(userRowIndex, 3).setValue(token); 
  sheet.getRange(userRowIndex, 4).setValue(expireDate.toISOString());

  var userName = _getUserNameById(userId);
  
  // Отримуємо права (Роль + ID)
  var permissions = _getPermissions(userId, role);

  return {
    success: true, 
    token: token, 
    user: { id: userId, name: userName, role: role, permissions: permissions }
  };
}

// Перевірка сесії (apiMe)
function apiMe(token) {
  if (!token) return {success: false};

  var ss = SpreadsheetApp.openById(AUTH_SHEET_ID);
  var sheet = ss.getSheetByName('Аркуш1');
  var data = sheet.getDataRange().getValues();

  for (var i = 1; i < data.length; i++) {
    var dbToken = data[i][2];
    var dbExpire = data[i][3];

    if (dbToken === token) {
      if (new Date() > new Date(dbExpire)) return {success: false, msg: "Сесія вийшла"};
      
      var userId = data[i][0];
      var role = data[i][4] ? data[i][4].toString() : ""; 
      var userName = _getUserNameById(userId);
      
      // Завжди повертаємо актуальні права
      var permissions = _getPermissions(userId, role);
      
      return {
        success: true, 
        user: { id: userId, name: userName, role: role, permissions: permissions }
      };
    }
  }
  return {success: false, msg: "Токен не знайдено"};
}

// ==========================================
// 2. СИСТЕМА ПРАВ (RBAC Core)
// ==========================================

// Головна функція збору прав
function _getPermissions(userId, roleName) {
  // Admin має доступ до всього
  if (!roleName || roleName.toLowerCase() === 'admin') return ['*'];
  if (!ROLE_SHEET_ID) return []; // Якщо таблиця ще не налаштована

  var ss = SpreadsheetApp.openById(ROLE_SHEET_ID);
  var sheet = ss.getSheetByName('Аркуш1');
  var data = sheet.getDataRange().getValues();
  
  var permissions = [];

  // 1. Права РОЛІ
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
  
  // Видаляємо дублікати
  return [...new Set(permissions)];
}

// Реєстр всіх кнопок/модулів системи (для Адмінки)
function apiGetSystemCapabilities() {
  return [
    { key: 'grading',       category: 'Модулі', label: 'Журнал оцінок' },
    { key: 'schedule',      category: 'Модулі', label: 'Розклад занять' },
    { key: 'students',      category: 'Модулі', label: 'База студентів' },
    { key: 'load',          category: 'Модулі', label: 'Навантаження' },
    { key: 'admin_panel',   category: 'Модулі', label: '🔴 Адмін-панель' },
    
    { key: 'can_edit_marks', category: 'Дії', label: 'Редагування оцінок' },
    { key: 'can_delete_marks', category: 'Дії', label: 'Видалення оцінок' }
  ];
}

// ==========================================
// 3. API АДМІН-ПАНЕЛІ
// ==========================================

// Отримати список юзерів з ролями
function apiGetUsers() {
  var ss = SpreadsheetApp.openById(AUTH_SHEET_ID);
  var sheet = ss.getSheetByName('Аркуш1');
  var data = sheet.getDataRange().getValues();
  var namesMap = _getNamesMap();
  
  var users = [];
  for (var i = 1; i < data.length; i++) {
    var id = data[i][0];
    if(!id) continue;
    users.push({
      id: id,
      name: namesMap[id] || "ID " + id,
      role: data[i][4] // Col E
    });
  }
  return users;
}

// Отримати налаштування з таблиці Roles
function apiGetRolesConfig() {
  var ss = SpreadsheetApp.openById(ROLE_SHEET_ID);
  var sheet = ss.getSheetByName('Аркуш1');
  var data = sheet.getDataRange().getValues();
  
  var roles = [];
  for (var i = 0; i < data.length; i++) {
    var rName = data[i][0];
    if(!rName) continue;
    try {
      roles.push({name: rName, permissions: JSON.parse(data[i][1])});
    } catch(e) {
      roles.push({name: rName, permissions: []});
    }
  }
  return roles;
}

// Оновити роль юзера
function apiUpdateUserRole(userId, newRole) {
  var ss = SpreadsheetApp.openById(AUTH_SHEET_ID);
  var sheet = ss.getSheetByName('Аркуш1');
  var data = sheet.getDataRange().getValues();
  
  for (var i = 1; i < data.length; i++) {
    if (data[i][0] == userId) {
      sheet.getRange(i + 1, 5).setValue(newRole); // Col E
      return {success: true, msg: "Роль оновлено"};
    }
  }
  return {success: false, msg: "Юзера не знайдено"};
}

// Зберегти права (Ролі або ID)
function apiSaveRoleConfig(entityName, perms) {
  var ss = SpreadsheetApp.openById(ROLE_SHEET_ID);
  var sheet = ss.getSheetByName('Аркуш1');
  var data = sheet.getDataRange().getValues();
  var json = JSON.stringify(perms);
  
  // Оновлення існуючого
  for (var i = 0; i < data.length; i++) {
    if (data[i][0].toString() == entityName.toString()) {
      sheet.getRange(i + 1, 2).setValue(json);
      return {success: true, msg: "Права збережено"};
    }
  }
  
  // Створення нового
  sheet.appendRow([entityName, json]);
  return {success: true, msg: "Створено нове правило"};
}

// ==========================================
// 4. РОБОЧІ ФУНКЦІЇ (Журнал)
// ==========================================

function apiSaveLog(token, grade, topic) {
  var auth = apiMe(token);
  if (!auth.success) return "Помилка авторизації";
  
  // Тут можна додати жорстку перевірку на сервері
  // if (!auth.user.permissions.includes('grading') && auth.user.role !== 'admin') return "Немає прав!";

  var ss = SpreadsheetApp.openById(TEACHER_SHEET_ID);
  var sheet = ss.getSheetByName('Logs');
  if (!sheet) { sheet = ss.insertSheet('Logs'); sheet.appendRow(['Дата', 'Час', 'Викладач', 'Дія', 'Тема']); }
  
  var d = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "dd.MM.yyyy");
  var t = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "HH:mm");
  
  sheet.appendRow([d, t, auth.user.name, grade, topic]);
  return "✅ Збережено";
}

// ==========================================
// 5. HELPER FUNCTIONS
// ==========================================

function _getUserNameById(id) {
  var ss = SpreadsheetApp.openById(TEACHER_SHEET_ID);
  var sheet = ss.getSheetByName('Аркуш1');
  var data = sheet.getDataRange().getValues();
  for (var i=1; i<data.length; i++) {
    if (data[i][0] == id) return data[i][1];
  }
  return "Невідомий";
}

function _getNamesMap() {
  var ss = SpreadsheetApp.openById(TEACHER_SHEET_ID);
  var sheet = ss.getSheetByName('Аркуш1');
  var data = sheet.getRange(2, 1, sheet.getLastRow()-1, 2).getValues();
  var map = {};
  data.forEach(r => map[r[0]] = r[1]);
  return map;
}

function _hash(str) {
  var raw = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, str.toString());
  var txt = '';
  for (var i = 0; i < raw.length; i++) {
    var hashVal = raw[i];
    if (hashVal < 0) { hashVal += 256; }
    if (hashVal.toString(16).length == 1) { txt += '0'; }
    txt += hashVal.toString(16);
  }
  return txt;
}

// Генератор хешу для першого пароля
function generateHashForTable() {
  // Замініть на свій пароль, запустіть і скопіюйте результат з логу
  Logger.log(_hash("admin000admin")); 
}