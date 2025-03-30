import express from 'express';
import cors from 'cors';
import { UrlStorage } from './db';

const app = express();
const port = 3000;

app.use(cors());
app.use(express.json());

// Initialize storage with purgeOnStart = true
const urlStorage = new UrlStorage(true);

// Add logging middleware
app.use((req, res, next) => {
  console.log(`${req.method} ${req.url}`);
  next();
});

app.post('/api/urls', (req, res) => {
  try {
    const { url, shortPath, expiration } = req.body;
    console.log(`Creating short URL for ${url} with path ${shortPath}, expiration: ${expiration}`);
    
    if (shortPath.length !== 4) {
      return res.status(400).json({ error: 'Short path must be exactly 4 characters' });
    }
    
    // Note: removed await since better-sqlite3 is synchronous
    const savedPath = urlStorage.saveUrl(url, shortPath, expiration);
    
    // Return the actual saved path which could be different if URL already exists
    console.log(`Returning shortPath: ${savedPath} (may be existing)`);
    res.json({ 
      success: true, 
      shortPath: savedPath,
      originalUrl: url,
      isExisting: savedPath !== shortPath
    });
  } catch (error) {
    console.error('Error saving URL:', error);
    res.status(500).json({ error: 'Failed to save URL' });
  }
});

// IMPORTANT: Move the specific route before the parameter route
// This fixed route should come BEFORE the /:shortPath route
app.get('/api/urls/exists/:shortPath', (req, res) => {
  try {
    const { shortPath } = req.params;
    const exists = urlStorage.urlExists(shortPath);
    res.json({ exists });
  } catch (error) {
    console.error('Error checking URL:', error);
    res.status(500).json({ error: 'Failed to check URL' });
  }
});

app.get('/api/urls/:shortPath', (req, res) => {
  try {
    const { shortPath } = req.params;
    console.log(`Looking up URL for path: ${shortPath}`);
    
    if (shortPath.length !== 4) {
      console.log(`Invalid short path length: ${shortPath.length}`);
      return res.status(404).json({ error: 'URL not found' });
    }
    
    // Note: removed await since better-sqlite3 is synchronous
    const url = urlStorage.getUrl(shortPath);
    
    if (!url) {
      return res.status(404).json({ error: 'URL not found' });
    }
    
    res.json(url);
  } catch (error) {
    console.error('Error retrieving URL:', error);
    res.status(500).json({ error: 'Failed to retrieve URL' });
  }
});

// Fix missing req parameter
app.get('/api/debug/urls', (req, res) => {
  try {
    const stmt = urlStorage.db.prepare('SELECT * FROM urls');
    const urls = stmt.all();
    return res.json({ urls });
  } catch (error) {
    return res.status(500).json({ error: String(error) });
  }
});

// Add a redirect endpoint
app.get('/:shortPath', (req, res) => {
  try {
    const { shortPath } = req.params;
    console.log(`Redirect request for: ${shortPath}`);
    
    if (shortPath.length !== 4) {
      console.log(`Invalid short path length: ${shortPath} (${shortPath.length})`);
      return res.status(404).send('Link not found');
    }
    
    const urlRecord = urlStorage.getUrl(shortPath);
    
    if (!urlRecord) {
      console.log(`URL not found for path: ${shortPath}`);
      return res.status(404).send('Link not found');
    }
    
    console.log(`Redirecting ${shortPath} to ${urlRecord.originalUrl}`);
    return res.redirect(urlRecord.originalUrl);
  } catch (error) {
    console.error('Error redirecting:', error);
    return res.status(500).send('Server error');
  }
});

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
