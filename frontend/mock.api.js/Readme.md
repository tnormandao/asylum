```js

// -----------------------------------------------------------------------------
// 3. EXAMPLE USAGE
// -----------------------------------------------------------------------------

// A helper function to simulate downloading a file.
function downloadObjectAsJson(exportObj, exportName){
  const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(exportObj, null, 2));
  const downloadAnchorNode = document.createElement('a');
  downloadAnchorNode.setAttribute("href", dataStr);
  downloadAnchorNode.setAttribute("download", exportName + ".json");
  document.body.appendChild(downloadAnchorNode);
  downloadAnchorNode.click();
  downloadAnchorNode.remove();
}

// 0. Define Schemas
const UserSchema = { name: { type: 'string', required: true } };
const PostSchema = {
  title: { type: 'string', required: true, minLength: 5 },
  content: { type: 'string', required: true },
  status: { type: 'string', required: true, enum: ['draft', 'published'] },
  userId: { type: 'string', required: true },
};

// 1. Prepare seed data (e.g., from a `seed.json` file)
const seedData = {
  users: [
    { id: 'user-1', name: 'Admin' }
  ],
  posts: [
    { id: 'post-1', title: 'Welcome Post', status: 'published', userId: 'user-1' }
  ]
};

// 2. Create API instance with seed data and a new version
const api = new MockApi('my-app-db-v3', {
  version: 3, // Bump version to trigger onupgradeneeded and seeding
  stores: ['users', 'posts'],
  seedData: seedData
});

// Define routes
// -- Posts --
api.post('/posts', PostSchema, (req, res, db) => db.add('posts', req.body).then(post => res.status(201).json(post)));
api.get('/posts', (req, res, db) => db.find('posts').then(p => res.json(p)));
 
// -- Users --
api.post('/users', UserSchema, (req, res, db) => db.add('users', req.body).then(user => res.status(201).json(user)));
api.get('/users/:userId', (req, res, db) => db.get('users', req.params.userId).then(user => user ? res.json(user) : res.status(404).send('Not Found')));

// 3. Run the demonstration
(async () => {
  await api.init();

  console.log("\n--- 1. VERIFYING SEED DATA ---");
  let res = await api.fetch('/posts');
  let data = await res.json();
  console.log('Initial posts from seed:', data);

  console.log("\n--- 2. ADDING NEW DATA ---");
  await api.fetch('/posts', {
    method: 'POST',
    body: JSON.stringify({ title: 'A New Post by User', status: 'draft', userId: 'user-1' })
  });
  res = await api.fetch('/posts');
  data = await res.json();
  console.log('Posts after adding one:', data);

  console.log("\n--- 3. EXPORTING CURRENT STATE ---");
  const exportedData = await api.exportData();
  console.log('Exported Data Object:', exportedData);
  // downloadObjectAsJson(exportedData, 'my-database-backup'); // Uncomment to download
  console.log('Data exported. (Uncomment the line above to trigger a download)');

  console.log("\n--- 4. IMPORTING A NEW STATE ---");
  const newState = {
      users: [{ id: 'user-99', name: 'Tester' }],
      posts: [
          { id: 'p-101', title: 'Imported Post A', status: 'published', userId: 'user-99' },
          { id: 'p-102', title: 'Imported Post B', status: 'published', userId: 'user-99' }
      ]
  };
  await api.importData(newState);
  console.log("\n--- 5. VERIFYING IMPORTED STATE ---");
  res = await api.fetch('/posts');
  data = await res.json();
  console.log('Posts after import:', data);
})();
```
  
