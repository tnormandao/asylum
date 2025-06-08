/**
 * MockApi v3.0: A class to simulate a backend API using IndexedDB.
 *
 * Features:
 * - Zero Dependencies: No external libraries required.
 * - Data Persistence: Uses IndexedDB to store data across sessions.
 * - Express.js-style Routing: Flexible routing like `api.get('/users/:id', ...)`).
 * - Built-in Schema Validation: For POST/PUT/PATCH requests.
 * - Advanced Querying: Supports filtering, sorting, and pagination.
 * - Data Seeding: Initialize the database with predefined data.
 * - Data Import/Export: Move database state in and out as a JSON object.
 */

// -----------------------------------------------------------------------------
// 1. HELPER CLASSES AND FUNCTIONS
// -----------------------------------------------------------------------------

/**
 * A simplified wrapper for asynchronous work with IndexedDB transactions.
 * Includes methods for complex queries and store management.
 */
class DbWrapper {
  constructor(db) {
    this.db = db;
  }

  _transaction(storeName, mode) {
    return this.db.transaction(storeName, mode).objectStore(storeName);
  }

  add(storeName, item) {
    return new Promise((resolve, reject) => {
      if (!item.id) {
        item.id = self.crypto.randomUUID();
      }
      const request = this._transaction(storeName, 'readwrite').add(item);
      request.onsuccess = () => resolve(item);
      request.onerror = () => reject(request.error);
    });
  }

  get(storeName, id) {
    return new Promise((resolve, reject) => {
      const request = this._transaction(storeName, 'readonly').get(id);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  update(storeName, item) {
    return new Promise((resolve, reject) => {
      const request = this._transaction(storeName, 'readwrite').put(item);
      request.onsuccess = () => resolve(item);
      request.onerror = () => reject(request.error);
    });
  }

  delete(storeName, id) {
    return new Promise((resolve, reject) => {
      const request = this._transaction(storeName, 'readwrite').delete(id);
      request.onsuccess = () => resolve(true);
      request.onerror = () => reject(request.error);
    });
  }

  find(storeName, { filter = {}, sort = {}, paginate = {} } = {}) {
    return new Promise((resolve, reject) => {
      let results = [];
      const store = this._transaction(storeName, 'readonly');
      const request = store.openCursor();

      request.onerror = () => reject(request.error);
      
      request.onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor) {
          const item = cursor.value;
          let match = true;
          for (const key in filter) {
            if (item[key] != filter[key]) {
              match = false;
              break;
            }
          }
          if (match) {
            results.push(item);
          }
          cursor.continue();
        } else {
          const sortKey = Object.keys(sort)[0];
          if (sortKey) {
            const order = sort[sortKey].toLowerCase();
            results.sort((a, b) => {
              if (a[sortKey] < b[sortKey]) return order === 'asc' ? -1 : 1;
              if (a[sortKey] > b[sortKey]) return order === 'asc' ? 1 : -1;
              return 0;
            });
          }
          if (paginate.page && paginate.limit) {
            const page = Math.max(1, paginate.page);
            const limit = paginate.limit;
            const startIndex = (page - 1) * limit;
            results = results.slice(startIndex, startIndex + limit);
          }
          resolve(results);
        }
      };
    });
  }
    
  clear(storeName) {
    return new Promise((resolve, reject) => {
      const request = this._transaction(storeName, 'readwrite').clear();
      request.onsuccess = () => resolve(true);
      request.onerror = () => reject(request.error);
    });
  }
}

/**
 * A helper to build a fetch-compatible Response object in an Express.js style (res.status().json()).
 */
class ResponseHelper {
  constructor() {
    this._status = 200;
    this._body = null;
    this._headers = new Headers({ 'Content-Type': 'application/json' });
  }

  status(code) {
    this._status = code;
    return this;
  }

  json(data) {
    this._body = JSON.stringify(data);
    this._headers.set('Content-Type', 'application/json');
    return this;
  }
  
  send(data) {
    if (typeof data === 'object' && data !== null) {
        this.json(data);
    } else {
        this._body = String(data);
        this._headers.set('Content-Type', 'text/plain');
    }
    return this;
  }

  build() {
    const statusTextMap = { 200: 'OK', 201: 'Created', 204: 'No Content', 400: 'Bad Request', 404: 'Not Found', 500: 'Internal Server Error' };
    return new Response(this._body, {
      status: this._status,
      statusText: statusTextMap[this._status] || '',
      headers: this._headers,
    });
  }
}

/**
 * A native function to validate data against a given schema.
 */
function validateSchema(data, schema) {
  const errors = {};
  if (typeof data !== 'object' || data === null) {
      return { success: false, errors: { _global: "Request body was expected to be an object." } };
  }

  for (const key in schema) {
    const rule = schema[key];
    const value = data[key];
    const fieldErrors = [];

    if (rule.required && (value === undefined || value === null)) {
      fieldErrors.push(`Field is required`);
    } else if (value !== undefined && value !== null) {
      if (rule.type && typeof value !== rule.type) {
        fieldErrors.push(`Type must be '${rule.type}'`);
      } else {
        switch (rule.type) {
          case 'string':
            if (rule.minLength && value.length < rule.minLength) fieldErrors.push(`Minimum length is ${rule.minLength}`);
            if (rule.maxLength && value.length > rule.maxLength) fieldErrors.push(`Maximum length is ${rule.maxLength}`);
            if (rule.pattern && !rule.pattern.test(value)) fieldErrors.push(`Does not match pattern`);
            break;
          case 'number':
            if (rule.min !== undefined && value < rule.min) fieldErrors.push(`Minimum value is ${rule.min}`);
            if (rule.max !== undefined && value > rule.max) fieldErrors.push(`Maximum value is ${rule.max}`);
            break;
        }
      }
      if (rule.enum && !rule.enum.includes(value)) {
        fieldErrors.push(`Value must be one of: ${rule.enum.join(', ')}`);
      }
    }
    
    if (fieldErrors.length > 0) {
      errors[key] = fieldErrors;
    }
  }

  const isValid = Object.keys(errors).length === 0;
  return { success: isValid, errors: !isValid ? errors : null };
}

// -----------------------------------------------------------------------------
// 2. THE MAIN MOCKAPI CLASS
// -----------------------------------------------------------------------------

class MockApi {
  constructor(dbName, options = {}) {
    this.dbName = dbName;
    this.options = {
        version: 1,
        stores: [],
        delay: { min: 50, max: 200 },
        seedData: null,
        ...options
    };
    this.db = null;
    this.dbWrapper = null;
    this.routes = [];
  }

  async init() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.options.version);

      request.onupgradeneeded = (event) => {
        console.log(`[MockApi] Upgrading database to version ${this.options.version}...`);
        const db = event.target.result;
        const tx = event.target.transaction;

        this.options.stores.forEach(storeName => {
          if (!db.objectStoreNames.contains(storeName)) {
            db.createObjectStore(storeName, { keyPath: 'id' });
          }
        });

        if (this.options.seedData) {
            console.log(`[MockApi] Seeding data...`);
            for (const storeName in this.options.seedData) {
                if (this.options.stores.includes(storeName)) {
                    const store = tx.objectStore(storeName);
                    const records = this.options.seedData[storeName];
                    records.forEach(record => {
                        store.put(record);
                    });
                }
            }
        }
      };

      request.onsuccess = (event) => {
        this.db = event.target.result;
        this.dbWrapper = new DbWrapper(this.db);
        console.log(`[MockApi] Database "${this.dbName}" initialized successfully.`);
        resolve(this);
      };
      request.onerror = (event) => {
        console.error(`[MockApi] Database initialization error:`, event.target.error);
        reject(event.target.error);
      };
    });
  }

  async exportData() {
    console.log(`[MockApi] Exporting data from stores: ${this.options.stores.join(', ')}`);
    const dataPromises = this.options.stores.map(async storeName => {
      const records = await this.dbWrapper.find(storeName);
      return { storeName, records };
    });
    
    const results = await Promise.all(dataPromises);
    
    return results.reduce((acc, { storeName, records }) => {
      acc[storeName] = records;
      return acc;
    }, {});
  }

  async importData(data) {
    const storeNamesToImport = Object.keys(data).filter(name => this.options.stores.includes(name));
    if (storeNamesToImport.length === 0) {
        console.warn(`[MockApi] Import data did not contain any known stores. Aborting.`);
        return false;
    }
    
    console.log(`[MockApi] Importing data into stores: ${storeNamesToImport.join(', ')}. Existing data will be overwritten.`);

    return new Promise((resolve, reject) => {
        const tx = this.db.transaction(storeNamesToImport, 'readwrite');
        tx.oncomplete = () => {
            console.log(`[MockApi] Data imported successfully.`);
            resolve(true);
        };
        tx.onerror = () => {
            console.error(`[MockApi] Data import failed.`, tx.error);
            reject(tx.error);
        };

        for (const storeName of storeNamesToImport) {
            const store = tx.objectStore(storeName);
            store.clear();
            const records = data[storeName] || [];
            records.forEach(record => {
                store.add(record);
            });
        }
    });
  }

  _register(method, path, ...args) {
    const [schema, handler] = args.length === 2 ? args : [null, args[0]];
    const pathSegments = path.split('/').filter(Boolean);
    const params = pathSegments
      .map((segment, index) => segment.startsWith(':') ? { name: segment.substring(1), index } : null)
      .filter(Boolean);

    this.routes.push({ method: method.toUpperCase(), path, pathSegments, params, schema, handler });
  }

  get(path, ...args) { this._register('GET', path, ...args); }
  post(path, ...args) { this._register('POST', path, ...args); }
  put(path, ...args) { this._register('PUT', path, ...args); }
  delete(path, ...args) { this._register('DELETE', path, ...args); }
  patch(path, ...args) { this._register('PATCH', path, ...args); }
  
  _findRoute(method, urlPath) {
    const requestSegments = urlPath.split('/').filter(Boolean);
    for (const route of this.routes) {
        if (route.method !== method || route.pathSegments.length !== requestSegments.length) continue;
        const params = {};
        let match = true;
        for (let i = 0; i < route.pathSegments.length; i++) {
            const routeSegment = route.pathSegments[i];
            const requestSegment = requestSegments[i];
            if (routeSegment.startsWith(':')) {
                params[routeSegment.substring(1)] = decodeURIComponent(requestSegment);
            } else if (routeSegment !== requestSegment) {
                match = false;
                break;
            }
        }
        if (match) return { route, params };
    }
    return null;
  }

  async fetch(input, options = {}) {
    if (!this.db) throw new Error("MockApi is not initialized. Call .init() before use.");
    
    const randomDelay = Math.random() * (this.options.delay.max - this.options.delay.min) + this.options.delay.min;
    await new Promise(res => setTimeout(res, randomDelay));

    const url = new URL(input, location.origin);
    const method = (options.method || 'GET').toUpperCase();
    const routeMatch = this._findRoute(method, url.pathname);

    if (!routeMatch) {
      return new ResponseHelper().status(404).json({ message: `Route ${method} ${url.pathname} not found.` }).build();
    }

    const { route, params } = routeMatch;
    let body = null;
    if(options.body) { try { body = JSON.parse(options.body); } catch(e) { body = options.body; } }

    if (route.schema && ['POST', 'PUT', 'PATCH'].includes(method)) {
      const validationResult = validateSchema(body, route.schema);
      if (!validationResult.success) {
        return new ResponseHelper().status(400).json({ message: "Validation Error", errors: validationResult.errors }).build();
      }
    }

    const req = { params, query: Object.fromEntries(url.searchParams.entries()), body };
    const res = new ResponseHelper();

    try {
      await route.handler(req, res, this.dbWrapper);
      return res.build();
    } catch(error) {
      console.error(`[MockApi] Error in handler for ${method} ${url.pathname}:`, error);
      return new ResponseHelper().status(500).json({ message: "Internal Server Error" }).build();
    }
  }
}
