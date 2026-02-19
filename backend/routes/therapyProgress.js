import { Router } from 'express';
import { UserTherapyProgress } from '../models/TherapyProgress.js';
import { User } from '../models/User.js';

const router = Router();

// Middleware to ensure CORS headers on all responses from this router
router.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  }
  next();
});

const THERAPIES = [
  'speech',
  'occupational',
  'behavioral',
  'special-education',
  'daily-activities',
  'therapy-avatar',
];

const LEVELS = 10;
const SESSIONS = 10;
const GAMES_PER_SESSION = 5;

const buildEmptyTherapy = (therapy) => ({
  therapy,
  currentLevel: 1,
  currentSession: 1,
  levels: Array.from({ length: LEVELS }, (_, i) => ({
    levelNumber: i + 1,
    sessions: Array.from({ length: SESSIONS }, (_, j) => ({
      sessionNumber: j + 1,
      completedGames: [],
      completed: false,
    })),
  })),
  updatedAt: new Date(),
});

router.get('/progress', async (req, res) => {
  // Ensure we always send a response, even on errors
  let responseSent = false;
  
  const sendError = (status, message, details) => {
    if (responseSent || res.headersSent) return;
    responseSent = true;
    const origin = req.headers.origin;
    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
    }
    res.status(status).json({ error: message, details });
  };
  
  const sendSuccess = (data) => {
    if (responseSent || res.headersSent) return;
    responseSent = true;
    const origin = req.headers.origin;
    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
    }
    res.json(data);
  };
  
  try {
    console.log('[THERAPY PROGRESS] GET /progress route hit');
    console.log('[THERAPY PROGRESS] Request headers:', {
      origin: req.headers.origin,
      'x-auth0-id': req.headers['x-auth0-id'],
      'x-auth0-email': req.headers['x-auth0-email'],
    });
    console.log('[THERAPY PROGRESS] Request auth info:', {
      auth0Id: req.auth0Id,
      userId: req.userId,
      auth0Email: req.auth0Email,
    });
    
    const user = await ensureUserDoc(req);
    console.log('[THERAPY PROGRESS] User found:', user._id);
    
    const doc = await UserTherapyProgress.findOne({ userId: user._id });
    console.log('[THERAPY PROGRESS] Progress doc found:', !!doc);
    
    const response = { therapies: doc?.therapies || [] };
    console.log('[THERAPY PROGRESS] Sending response with', response.therapies.length, 'therapies');
    sendSuccess(response);
  } catch (error) {
    console.error('[THERAPY PROGRESS] Error in /progress route:', error);
    console.error('[THERAPY PROGRESS] Error stack:', error.stack);
    sendError(500, 'Failed to load therapy progress', error.message);
  }
});

router.post('/progress/init', async (req, res) => {
  try {
    // Ensure CORS headers are set
    const origin = req.headers.origin;
    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
    }
    
    const user = await ensureUserDoc(req);
    let doc = await UserTherapyProgress.findOne({ userId: user._id });
    if (!doc) {
      doc = await UserTherapyProgress.create({
        userId: user._id,
        therapies: THERAPIES.map(buildEmptyTherapy),
      });
    }
    return res.json({ ok: true, therapies: doc.therapies });
  } catch (error) {
    console.error('therapy progress init error', error);
    
    // Ensure CORS headers on error
    const origin = req.headers.origin;
    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
    }
    
    if (res.headersSent) return;
    return res.status(500).json({ error: 'Failed to init therapy progress' });
  }
});

router.post('/progress/advance', async (req, res) => {
  try {
    // Ensure CORS headers are set
    const origin = req.headers.origin;
    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
    }
    
    const user = await ensureUserDoc(req);
    const { therapy, levelNumber, sessionNumber, gameId, markCompleted } = req.body || {};
    if (!THERAPIES.includes(therapy)) {
      return res.status(400).json({ error: 'Invalid therapy' });
    }

    const doc = await UserTherapyProgress.findOne({ userId: user._id });
    if (!doc) return res.status(404).json({ error: 'Not initialized' });

    const t = doc.therapies.find((x) => x.therapy === therapy);
    if (!t) return res.status(404).json({ error: 'Therapy not found' });
    const lvl = t.levels.find((l) => l.levelNumber === Number(levelNumber));
    if (!lvl) return res.status(404).json({ error: 'Level not found' });
    const sess = lvl.sessions.find((s) => s.sessionNumber === Number(sessionNumber));
    if (!sess) return res.status(404).json({ error: 'Session not found' });

    if (gameId && !sess.completedGames.includes(gameId) && sess.completedGames.length < GAMES_PER_SESSION) {
      sess.completedGames.push(gameId);
    }
    if (markCompleted || sess.completedGames.length >= GAMES_PER_SESSION) {
      sess.completed = true;
      sess.lastPlayedAt = new Date();
    }

    // Auto-advance pointers if session completed
    if (sess.completed) {
      if (t.currentSession < SESSIONS) {
        t.currentSession += 1;
      } else if (t.currentLevel < LEVELS) {
        t.currentLevel += 1;
        t.currentSession = 1;
      }
    }
    t.updatedAt = new Date();
    await doc.save();
    return res.json({ ok: true, therapy: t });
  } catch (error) {
    console.error('therapy progress advance error', error);
    
    // Ensure CORS headers on error
    const origin = req.headers.origin;
    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
    }
    
    if (res.headersSent) return;
    return res.status(500).json({ error: 'Failed to update therapy progress' });
  }
});

router.post('/progress/reset', async (req, res) => {
  try {
    // Ensure CORS headers are set
    const origin = req.headers.origin;
    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
    }
    
    const user = await ensureUserDoc(req);
    const { therapy } = req.body || {};
    if (therapy && !THERAPIES.includes(therapy)) {
      return res.status(400).json({ error: 'Invalid therapy' });
    }

    let doc = await UserTherapyProgress.findOne({ userId: user._id });
    if (!doc) {
      doc = await UserTherapyProgress.create({
        userId: user._id,
        therapies: THERAPIES.map(buildEmptyTherapy),
      });
    } else if (therapy) {
      doc.therapies = doc.therapies.map((t) => (t.therapy === therapy ? buildEmptyTherapy(therapy) : t));
    } else {
      doc.therapies = THERAPIES.map(buildEmptyTherapy);
    }
    await doc.save();
    return res.json({ ok: true, therapies: doc.therapies });
  } catch (error) {
    console.error('therapy progress reset error', error);
    
    // Ensure CORS headers on error
    const origin = req.headers.origin;
    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
    }
    
    if (res.headersSent) return;
    return res.status(500).json({ error: 'Failed to reset therapy progress' });
  }
});

// Catch-all error handler for this router
router.use((err, req, res, next) => {
  console.error('[THERAPY ROUTER] Unhandled error:', err);
  console.error('[THERAPY ROUTER] Error stack:', err.stack);
  
  // Ensure CORS headers on error
  const origin = req.headers.origin;
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  }
  
  if (!res.headersSent) {
    res.status(500).json({ error: 'Internal server error', details: err.message });
  }
});

export { router as therapyProgressRouter };

// Helpers
async function ensureUserDoc(req) {
  const auth0Id = req.auth0Id || req.userId;
  const email = req.auth0Email || '';
  const name = req.auth0Name || '';
  
  console.log('[ENSURE USER DOC] auth0Id:', auth0Id, 'email:', email, 'name:', name);
  
  if (!auth0Id) {
    console.error('[ENSURE USER DOC] Missing auth0Id in request');
    throw new Error('Missing auth0Id');
  }
  
  try {
    const user = await User.findOneAndUpdate(
      { auth0Id },
      {
        $setOnInsert: {
          auth0Id,
          email,
          name: name || email || 'User',
          rewards: {},
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
    console.log('[ENSURE USER DOC] User found/created:', user._id);
    return user;
  } catch (error) {
    console.error('[ENSURE USER DOC] Error finding/creating user:', error);
    throw error;
  }
}


