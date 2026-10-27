// Togo Actu — stockage IndexedDB (pas de localStorage)
var DB_NAME = 'TogoActuDB', DB_VERSION = 1;
var db = null;

function openDB() {
  return new Promise(function(resolve, reject) {
    var req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = function(e) {
      var d = e.target.result;
      if (!d.objectStoreNames.contains('favorites')) d.createObjectStore('favorites', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('feeds')) d.createObjectStore('feeds', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('cache')) d.createObjectStore('cache', { keyPath: 'key' });
    };
    req.onsuccess = function(e) { db = e.target.result; resolve(db); };
    req.onerror = function(e) { reject(e); };
  });
}
function tx(store, mode) { return db.transaction(store, mode).objectStore(store); }
function idbPut(store, val) { return new Promise(function(res, rej) { var r = tx(store, 'readwrite').put(val); r.onsuccess = function() { res(); }; r.onerror = rej; }); }
function idbGetAll(store) { return new Promise(function(res, rej) { var r = tx(store, 'readonly').getAll(); r.onsuccess = function() { res(r.result); }; r.onerror = rej; }); }
function idbDelete(store, id) { return new Promise(function(res, rej) { var r = tx(store, 'readwrite').delete(id); r.onsuccess = function() { res(); }; r.onerror = rej; }); }
function idbGet(store, key) { return new Promise(function(res, rej) { var r = tx(store, 'readonly').get(key); r.onsuccess = function() { res(r.result); }; r.onerror = rej; }); }

var DEFAULT_FEEDS = [
  { id: 'rfi', name: 'RFI Afrique', url: 'https://www.rfi.fr/fr/rss/afrique' },
  { id: 'bbc', name: 'BBC Afrique', url: 'https://feeds.bbci.co.uk/french/rss.xml' },
  { id: 'ja', name: 'Jeune Afrique', url: 'https://www.jeuneafrique.com/feed/' }
];

var WCODES = { 0:['Ciel dégagé','☀️'],1:['Plutôt dégagé','🌤️'],2:['Partiellement nuageux','⛅'],3:['Couvert','☁️'],45:['Brouillard','🌫️'],48:['Brouillard givrant','🌫️'],51:['Bruine légère','🌦️'],53:['Bruine','🌦️'],55:['Bruine forte','🌧️'],61:['Pluie légère','🌦️'],63:['Pluie','🌧️'],65:['Pluie forte','🌧️'],71:['Neige légère','🌨️'],80:['Averses légères','🌦️'],81:['Averses','🌧️'],82:['Averses violentes','⛈️'],95:['Orage','⛈️'],96:['Orage + grêle','⛈️'],99:['Orage + grêle','⛈️'] };

async function loadWeather() {
  var view = document.getElementById('view-meteo');
  var url = 'https://api.open-meteo.com/v1/forecast?latitude=6.1319&longitude=1.2228&current=temperature_2m,relative_humidity_2m,wind_speed_10m,weather_code&daily=temperature_2m_max,temperature_2m_min&timezone=Africa%2FLome';
  var data = null;
  try {
    var r = await fetch(url); data = await r.json();
    await idbPut('cache', { key: 'weather', data: data, ts: Date.now() });
  } catch (e) {
    var c = await idbGet('cache', 'weather');
    if (c) { data = c.data; view.insertAdjacentHTML('afterbegin', '<p class=meta>Hors-ligne : données en cache</p>'); }
  }
  if (!data) { view.innerHTML = '<p class=empty>Impossible de charger la météo.</p>'; return; }
  var cur = data.current;
  var wc = WCODES[cur.weather_code] || ['—','🌡️'];
  view.innerHTML = '<div class="card weather-main"><div style="font-size:3rem">' + wc[1] + '</div>' +
    '<div class="temp">' + Math.round(cur.temperature_2m) + '°C</div>' +
    '<div class="desc">' + wc[0] + ' — Lomé</div>' +
    '<div class="stats">' +
    '<div><div class="val">' + cur.relative_humidity_2m + '%</div><div class="lbl">Humidité</div></div>' +
    '<div><div class="val">' + Math.round(cur.wind_speed_10m) + ' km/h</div><div class="lbl">Vent</div></div>' +
    '<div><div class="val">' + Math.round(data.daily.temperature_2m_max[0]) + '° / ' + Math.round(data.daily.temperature_2m_min[0]) + '°</div><div class="lbl">Max / Min</div></div>' +
    '</div></div>';
}

async function getFeeds() {
  var feeds = await idbGetAll('feeds');
  if (feeds.length === 0) {
    for (var i = 0; i < DEFAULT_FEEDS.length; i++) await idbPut('feeds', DEFAULT_FEEDS[i]);
    feeds = DEFAULT_FEEDS;
  }
  return feeds;
}

async function fetchFeed(feed) {
  var proxy = 'https://api.allorigins.win/raw?url=' + encodeURIComponent(feed.url);
  try {
    var r = await fetch(proxy);
    if (!r.ok) throw new Error('http ' + r.status);
    var text = await r.text();
    var doc = new DOMParser().parseFromString(text, 'text/xml');
    var items = Array.from(doc.querySelectorAll('item, entry')).slice(0, 15);
    return items.map(function(it) {
      var t = it.querySelector('title'); var l = it.querySelector('link'); var d = it.querySelector('pubDate, published, updated');
      return {
        id: (feed.id + '-' + (l ? (l.textContent || l.getAttribute('href')) : (t ? t.textContent : ''))).slice(0, 120),
        title: t ? t.textContent : '(sans titre)',
        link: l ? (l.textContent || l.getAttribute('href')) : '',
        pubDate: d ? new Date(d.textContent).toLocaleString('fr-FR') : '',
        source: feed.name
      };
    });
  } catch (e) { return []; }
}

async function loadNews() {
  var list = document.getElementById('news-list');
  list.innerHTML = '<p class=empty>Chargement…</p>';
  var feeds = await getFeeds();
  var results = await Promise.all(feeds.map(fetchFeed));
  var articles = results.flat();
  if (articles.length === 0) {
    var c = await idbGet('cache', 'news');
    if (c && c.data.length) articles = c.data;
  } else {
    await idbPut('cache', { key: 'news', data: articles, ts: Date.now() });
  }
  if (articles.length === 0) { list.innerHTML = '<p class=empty>Aucune actualité (vérifie ta connexion).</p>'; return; }
  var favs = await idbGetAll('favorites');
  var favIds = {}; favs.forEach(function(f) { favIds[f.id] = 1; });
  list.innerHTML = '';
  articles.forEach(function(a) {
    var star = favIds[a.id] ? '⭐' : '☆';
    var el = document.createElement('div');
    el.className = 'card';
    el.innerHTML = '<button class="btn-fav" data-id=' + encodeURIComponent(a.id) + '>' + star + '</button>' +
      '<h3>' + a.title + '</h3>' +
      '<p class="meta">' + a.source + (a.pubDate ? ' · ' + a.pubDate : '') + '</p>' +
      '<p><a href="' + a.link + '" target="_blank">Lire l article →</a></p>';
    list.appendChild(el);
  });
  list.querySelectorAll('.btn-fav').forEach(function(b) {
    b.addEventListener('click', function() { toggleFav(b.getAttribute('data-id'), articles, b); });
  });
}

async function toggleFav(encId, articles, btn) {
  var id = decodeURIComponent(encId);
  var existing = await idbGet('favorites', id);
  if (existing) { await idbDelete('favorites', id); btn.textContent = '☆'; }
  else {
    var a = articles.find(function(x) { return x.id === id; });
    if (a) { await idbPut('favorites', a); btn.textContent = '⭐'; }
  }
}

async function loadFavs() {
  var list = document.getElementById('fav-list');
  var favs = await idbGetAll('favorites');
  if (favs.length === 0) { list.innerHTML = '<p class=empty>Aucun favori. Tape l étoile ☆ sur un article.</p>'; return; }
  list.innerHTML = '';
  favs.forEach(function(a) {
    var el = document.createElement('div');
    el.className = 'card';
    el.innerHTML = '<button class="btn-fav" data-id=' + encodeURIComponent(a.id) + '>🗑️</button>' +
      '<h3>' + a.title + '</h3>' +
      '<p class="meta">' + a.source + '</p>' +
      '<p><a href="' + a.link + '" target="_blank">Lire →</a></p>';
    list.appendChild(el);
  });
  list.querySelectorAll('.btn-fav').forEach(function(b) {
    b.addEventListener('click', async function() { await idbDelete('favorites', decodeURIComponent(b.getAttribute('data-id'))); loadFavs(); });
  });
}

document.getElementById('tabs').addEventListener('click', function(e) {
  var v = e.target.getAttribute('data-view');
  if (!v) return;
  document.querySelectorAll('.view').forEach(function(s) { s.classList.add('hidden'); });
  document.getElementById('view-' + v).classList.remove('hidden');
  document.querySelectorAll('#tabs button').forEach(function(b) { b.classList.toggle('active', b === e.target); });
  if (v === 'actus') loadNews();
  if (v === 'favoris') loadFavs();
  if (v === 'meteo') loadWeather();
});

(async function() {
  await openDB();
  document.querySelector('#tabs button').classList.add('active');
  loadWeather();
})();
