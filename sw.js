importScripts(
  "https://cdnjs.cloudflare.com/ajax/libs/crypto-js/3.1.2/rollups/md5.js"
);
importScripts(
  "https://cdn.jsdelivr.net/npm/idb-keyval@3/dist/idb-keyval-iife.min.js"
);

const store = new idbKeyval.Store("My-App-GQL-Cache", "PostResponses");

var CACHE = "cache-v1";

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys().then(function (keyList) {
      return Promise.all(
        keyList
          .filter(function (key) {
            if (key !== CACHE) return true;
          })
          .map(function (cacheName) {
            return caches.delete(cacheName);
          })
      );
    })
  );
});

self.addEventListener("install", function (evt) {
  evt.waitUntil(precache());
});

function precache() {
  return caches.open(CACHE).then(function (cache) {
    return cache.addAll([
      "offline.html",
    //other precachable assets you want to add
    ]);
  });
}

self.addEventListener("fetch", function (event) {
  if (event.request.method === "POST") {
    event.respondWith(staleWhileRevalidate(event));
  }

  if (event.request.method === "GET") {
    if (event.request.url.indexOf("chrome-extension") === -1) { //if chrome extension gets into the way
      if (navigator.onLine) {
        event.respondWith(
          fetch(event.request)
            .then(function (networkRes) {
              return caches.open(CACHE).then(function (cache) {
                cache.put(event.request, networkRes.clone());
                return networkRes;
              });
            })
            .catch((err) => {
              console.error(err);
            })
        );
      } else if (!navigator.onLine || event.request.mode === "navigate")
        event.respondWith(
          caches
            .match(event.request)
            .then(function (cachedRes) {
              return cachedRes;
            })
            .catch(function () {
              return caches.match("/offline.html");
            })
        );
    }
  }
});

async function staleWhileRevalidate(event) {
  let fetchPromise;
  let cachedResponse = await getCache(event);
  if (navigator.onLine) {
    fetchPromise = fetch(event.request.clone())
      .then((response) => {
        setCache(event, response.clone());
        return response;
      })
      .catch((err) => {
        console.error(err);
      });
  }
  return navigator.onLine ? fetchPromise : Promise.resolve(cachedResponse);
}

async function getCache(event) {
  let request = event.request.clone();
  let data;
  try {
    let body = await request.json();
    let id =
      CryptoJS.MD5(body.query).toString() +
      CryptoJS.MD5(event.request.referrer).toString();
    data = await idbKeyval.get(id, store);
    if (!data) return null;

    // Check cache max age.
    let cacheControl = request.headers.get("Cache-Control");
    let maxAge = cacheControl ? parseInt(cacheControl.split("=")[1]) : 3600;
    if (Date.now() - data.timestamp > maxAge * 1000) {
      return null;
    }
    let res = new Response(JSON.stringify(data.response.body), data.response);
    if (res.ok) {
      return res;
    }
  } catch (err) {
    return null;
  }
}

async function setCache(event, response) {
  let request = event.request.clone();
  var key, data;

  let body = await request.json();
  let id =
    CryptoJS.MD5(body.query).toString() +
    CryptoJS.MD5(event.request.referrer).toString();

  var entry = {
    query: body.query,
    response: await serializeResponse(response),
    timestamp: Date.now(),
  };
  idbKeyval.set(id, entry, store);
}

async function serializeResponse(response) {
  let serializedHeaders = {};
  for (var entry of response.headers.entries()) {
    serializedHeaders[entry[0]] = entry[1];
  }
  let serialized = {
    headers: serializedHeaders,
    status: response.status,
    statusText: response.statusText,
  };
  serialized.body = await response.json();
  return serialized;
}
