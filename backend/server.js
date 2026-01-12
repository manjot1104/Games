import cors from 'cors';
import 'dotenv/config';
import express from 'express';
import fs from 'fs';
import mongoose from 'mongoose';
import multer from 'multer';
import path from 'path';
import { SKILL_LOOKUP } from './constants/skills.js';
import { buildInsights } from './lib/insights.js';
import { buildNextActions, buildRecommendations, computeGlobalLevel, levelLabelFor } from './lib/recommendations.js';
import { Message } from './models/Message.js';
import { Session } from './models/Session.js';
import { User } from './models/User.js';
import gameRoutes from './routes/gameRoutes.js';
import razorpayWebhookRouter from './routes/razorpayWebhook.js';
import { smartExplorerRouter } from './routes/smartExplorer.js';
import subscriptionRouter from './routes/subscription.js';
import { tapGame } from './routes/tapGame.js';
import { therapyProgressRouter } from './routes/therapyProgress.js';

const app = express();
// Behind proxies (Vercel/Render/Nginx), respect X-Forwarded-* headers
app.set('trust proxy', true);

// Handle OPTIONS requests FIRST - before any middleware that might redirect
app.options('*', (req, res) => {
  const origin = req.headers.origin;
  const allowedOrigins = [
    'https://child-wellness.vercel.app',
    'https://games-zeta-one.vercel.app',
    'https://autismplay.in',
    'https://www.autismplay.in',
    'http://localhost:19006',
    'http://localhost:3000',
    'http://localhost:8081',
    'http://localhost:8080',
  ];
  
  if (origin && allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-auth0-id, x-auth0-email, x-auth0-name');
    res.setHeader('Access-Control-Max-Age', '86400'); // 24 hours
  }
  res.status(204).end();
});

// CORS configuration - single instance with proper options
app.use(cors({
  origin: [
    'https://child-wellness.vercel.app',
    'https://games-zeta-one.vercel.app',
    'https://autismplay.in',
    'https://www.autismplay.in',
    'http://localhost:19006',
    'http://localhost:3000',
    'http://localhost:8081',
    'http://localhost:8080',
  ],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-auth0-id', 'x-auth0-email', 'x-auth0-name'],
  preflightContinue: false,
  optionsSuccessStatus: 204
}));

// TODO: Auth0 JWT middleware goes here
// app.use(auth0JWTMiddleware());

// ---- serve /static so the app can load uploaded images
app.use('/static', express.static(path.join(process.cwd(), 'static')));

// ---- ensure upload dir exists
const uploadDir = path.join(process.cwd(), 'static', 'uploads');
fs.mkdirSync(uploadDir, { recursive: true });

// ---- configure multer (save to /static/uploads)
const storage = multer.diskStorage({
  destination: (_, __, cb) => {
    console.log('Multer destination:', uploadDir);
    cb(null, uploadDir);
  },
  filename: (_, file, cb) => {
    const ext = path.extname(file.originalname || '');
    const name = ${Date.now()}-${Math.round(Math.random() * 1e6)}${ext};
    console.log('Multer filename:', name);
    cb(null, name);
  },
});
const fileFilter = (_, file, cb) => {
  console.log('Multer file filter - mimetype:', file.mimetype);
  const ok = /^image\/(png|jpe?g|gif|webp)$/.test(file.mimetype);
  console.log('Multer file filter - allowed:', ok);
  cb(ok ? null : new Error('Only image files allowed'), ok);
};
const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 1 * 1024 * 1024 } // 1MB
});

// ---- upload route (auth required) - MUST be before express.json()
app.post('/api/upload', requireAuth, upload.single('file'), (req, res) => {
  console.log('Upload endpoint hit');
  console.log('Request body:', req.body);
  console.log('Request file:', req.file);
  console.log('User ID:', req.userId);

  if (!req.file) {
    console.log('No file uploaded');
    return res.status(400).json({ error: 'No file uploaded' });
  }

  // public URL for the image (proxy-safe) + relative path for future-proofing
  const proto = (req.get('x-forwarded-proto') || req.protocol || 'https').split(',')[0].trim();
  const host = (req.get('x-forwarded-host') || req.get('host'));
  const rel = /static/uploads/${req.file.filename};
  const url = ${proto}://${host}${rel};
  console.log('Generated URL:', url);
  res.json({ ok: true, url, path: rel });
});

// Raw body parser for Razorpay webhooks (must be before express.json)
app.use('/api/webhooks/razorpay', express.raw({ type: 'application/json' }));

// JSON middleware - MUST be after multer routes and webhook routes
app.use(express.json());


// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ ok: true });
});

const mongoUri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/child_wellness';

async function ensureUser(auth0Id, email, name) {
  // Use upsert to create or update user with Auth0 info
  const user = await User.findOneAndUpdate(
    { auth0Id },
    {
      $setOnInsert: {
        auth0Id,
        email: email || '',
        name: name || email || 'User',
        rewards: {
          xp: 0,
          coins: 0,
          hearts: 5,
          streakDays: 0,
          lastPlayedDate: null,
          totalGamesPlayed: 0
        }
      }
    },
    {
      upsert: true,
      new: true,
      setDefaultsOnInsert: true
    }
  );

  if (user.isNew) {
    console.log(Created new user: ${auth0Id} with email: ${email});
  } else {
    console.log(Found existing user: ${auth0Id} with email: ${email});
  }

  return user;
}

// Replace requireAuth to extract Auth0 user info from request body or JWT
function requireAuth(req, res, next) {
  // For now, get auth0Id from request body or headers (we'll send it from frontend)
  // TODO: In production, parse Auth0 JWT from Authorization header
  const auth0Id = req.body?.auth0Id || req.headers['x-auth0-id'] || 'auth0_test_user';
  const email = req.body?.email || req.headers['x-auth0-email'] || '';
  const name = req.body?.name || req.headers['x-auth0-name'] || '';

  req.auth0Id = auth0Id;
  req.auth0Email = email;
  req.auth0Name = name;
  req.userId = auth0Id; // Keep for backward compatibility
  next();
}
// Add tap game routes
app.use('/api/tap', requireAuth, tapGame);
app.use('/api/smart-explorer', requireAuth, smartExplorerRouter);
app.use('/api/therapy', requireAuth, therapyProgressRouter);
app.use('/api/games', requireAuth, gameRoutes);

// Subscription and payment routes (require auth)
app.use('/api/subscription', requireAuth, subscriptionRouter);

// Razorpay webhook (NO auth required - uses signature verification)
app.use('/api/webhooks', razorpayWebhookRouter);

const SKILL_ALPHA = 0.3;
const SKILL_LEVELS = [
  { level: 4, threshold: 85, minStreak: 3 },
  { level: 3, threshold: 70, minStreak: 0 },
  { level: 2, threshold: 50, minStreak: 0 },
  { level: 1, threshold: 0, minStreak: 0 },
];

function getSkillsMap(rewards = {}) {
  if (!rewards.skills) {
    rewards.skills = new Map();
  } else if (!(rewards.skills instanceof Map) && typeof rewards.skills === 'object') {
    rewards.skills = new Map(Object.entries(rewards.skills));
  }
  return rewards.skills;
}

function computeSkillLevel(accuracy, streak) {
  for (const rule of SKILL_LEVELS) {
    if (accuracy >= rule.threshold && streak >= (rule.minStreak || 0)) return rule.level;
  }
  return 1;
}

function updateSkillBucket(bucket, entry) {
  const prompts = Number(entry.prompts ?? entry.total ?? entry.totalQuestions ?? 0);
  const correct = Number(entry.correct ?? entry.correctPrompts ?? 0);
  const attempts = Number(entry.attempts ?? prompts);
  const avgResponseMs = Number(entry.avgResponseMs ?? entry.responseMs ?? 0);
  const prevAccuracy = bucket.accuracy || 0;
  const prevEwma = bucket.ewmaAccuracy || prevAccuracy;

  bucket.totalPrompts = (bucket.totalPrompts || 0) + prompts;
  bucket.correctPrompts = (bucket.correctPrompts || 0) + correct;
  bucket.attempts = (bucket.attempts || 0) + attempts;

  if (prompts > 0) {
    const sessionAcc = Math.max(0, Math.min(100, (correct / Math.max(prompts, 1)) * 100));
    bucket.accuracy =
      bucket.totalPrompts > 0
        ? Math.round((bucket.correctPrompts / bucket.totalPrompts) * 100)
        : Math.round(sessionAcc);
    bucket.ewmaAccuracy =
      prevEwma != null ? (1 - SKILL_ALPHA) * prevEwma + SKILL_ALPHA * sessionAcc : sessionAcc;

    if (avgResponseMs > 0) {
      const prevAvg = bucket.avgResponseMs || avgResponseMs;
      bucket.avgResponseMs =
        bucket.totalPrompts > 0
          ? Math.round(
            (prevAvg * (bucket.totalPrompts - prompts) + avgResponseMs * prompts) /
            Math.max(bucket.totalPrompts, 1),
          )
          : avgResponseMs;
    }

    if (sessionAcc >= 70) {
      bucket.streak = (bucket.streak || 0) + 1;
    } else {
      bucket.streak = 0;
    }
    bucket.bestStreak = Math.max(bucket.bestStreak || 0, bucket.streak || 0);
  }

  const today = new Date().toISOString().slice(0, 10);
  bucket.lastPlayedDate = today;
  bucket.level = computeSkillLevel(bucket.accuracy || 0, bucket.streak || 0);
  bucket.trend = Math.round((bucket.accuracy || 0) - prevAccuracy);
}
// app.use('/api/content', content);
// app.use('/api/utterances', utterances);

// Test endpoint for network connectivity
app.get('/api/test', (req, res) => {
  console.log('🔍 Test endpoint hit from:', req.headers['user-agent']);
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Create or fetch the authenticated user immediately after verification/login
app.post('/api/users/ensure', requireAuth, async (req, res) => {
  try {
    const auth0Id = req.body?.auth0Id || req.auth0Id;
    const email = req.body?.email || req.auth0Email;
    const name = req.body?.name || req.auth0Name;

    if (!auth0Id) {
      console.error('ensure-user: missing auth0Id', {
        headers: {
          xAuth0Id: req.headers['x-auth0-id'],
          auth: req.headers.authorization,
        },
        body: req.body,
      });
      return res.status(401).json({ ok: false, error: 'Missing auth0Id' });
    }

    const user = await ensureUser(auth0Id, email, name);
    res.json({
      ok: true,
      user: {
        id: user._id,
        auth0Id: user.auth0Id,
        name: user.name,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        dob: user.dob,
        gender: user.gender,
        rewards: user.rewards,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      },
    });
  } catch (error) {
    console.error('Failed to ensure user:', error);
    res.status(500).json({ ok: false, error: 'Failed to ensure user' });
  }
});

// Get current user's profile
app.get('/api/me/profile', requireAuth, async (req, res) => {
  try {
    const auth0Id = req.auth0Id;
    const email = req.auth0Email || '';
    const name = req.auth0Name || '';
    if (!auth0Id) {
      console.error('get-profile: missing auth0Id');
      return res.status(401).json({ error: 'Missing auth0Id' });
    }
    const user = await ensureUser(auth0Id, email, name);
    res.json({
      firstName: user.firstName || '',
      lastName: user.lastName || '',
      email: user.email || '',
      dob: user.dob || null,
      gender: user.gender || null,
      phoneCountryCode: user.phoneCountryCode || '+91',
      phoneNumber: user.phoneNumber || '',
    });
  } catch (_e) {
    res.status(500).json({ error: 'Failed to load profile' });
  }
});

// Update current user's profile (DOB immutable once set)
app.post('/api/me/profile', requireAuth, async (req, res) => {
  try {
    const auth0Id = req.auth0Id;
    const email = req.auth0Email || '';
    const name = req.auth0Name || '';
    if (!auth0Id) {
      console.error('update-profile: missing auth0Id. Headers:', {
        xAuth0Id: req.headers['x-auth0-id'],
        authHeader: req.headers.authorization,
      });
      return res.status(401).json({ ok: false, error: 'Missing auth0Id' });
    }
    const { firstName, lastName, dob, gender, phoneCountryCode, phoneNumber } = req.body || {};
    const user = await ensureUser(auth0Id, email, name);
    if (typeof firstName === 'string') user.firstName = firstName.trim();
    if (typeof lastName === 'string') user.lastName = lastName.trim();
    // Allow updating dob whenever a valid value is provided.
    // Parse strictly as YYYY-MM-DD instead of relying on Date(dob) heuristics.
    if (typeof dob === 'string' && dob.trim()) {
      const trimmed = dob.trim();
      const m = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (m) {
        const year = Number(m[1]);
        const month = Number(m[2]);
        const day = Number(m[3]);
        const parsed = new Date(Date.UTC(year, month - 1, day));
        if (!isNaN(parsed.getTime())) {
          user.dob = parsed;
        }
      }
    }
    // Allow setting gender only if not already set
    if (!user.gender && gender && ['male', 'female', 'other', 'prefer-not-to-say'].includes(gender)) {
      user.gender = gender;
    }
    // Phone number - required and can be updated
    if (typeof phoneCountryCode === 'string' && phoneCountryCode.trim()) {
      user.phoneCountryCode = phoneCountryCode.trim();
    }
    if (typeof phoneNumber === 'string' && phoneNumber.trim()) {
      // Store only digits
      user.phoneNumber = phoneNumber.replace(/\D/g, '');
    }
    // Maintain name field as display name
    user.name = [user.firstName, user.lastName].filter(Boolean).join(' ') || user.name;
    await user.save();
    res.json({ ok: true });
  } catch (e) {
    console.error('Update profile failed:', e?.message || e, {
      stack: e?.stack,
    });
    res.status(500).json({ ok: false, error: 'Failed to update profile' });
  }
});



app.post('/api/me/game-feedback', requireAuth, async (req, res) => {
  try {
    const auth0Id = req.auth0Id;
    if (!auth0Id) return res.status(401).json({ error: 'Unauthorized' });
    const { at, mood, notes, observer } = req.body || {};
    if (!at) return res.status(400).json({ error: 'Missing timestamp' });

    const user = await ensureUser(auth0Id, req.auth0Email || '', req.auth0Name || '');
    const session = await Session.findOne({ userId: user._id });
    if (!session || !(session.gameLogs && session.gameLogs.length)) {
      return res.status(404).json({ error: 'No game logs found' });
    }

    const target = session.gameLogs.find((log) => {
      if (!log?.at) return false;
      const logISO = (log.at instanceof Date ? log.at : new Date(log.at)).toISOString();
      return logISO === new Date(at).toISOString();
    });

    if (!target) {
      return res.status(404).json({ error: 'Game log not found' });
    }

    target.feedback = {
      mood: typeof mood === 'number' ? mood : undefined,
      notes: typeof notes === 'string' && notes.trim() ? notes.trim() : undefined,
      observer: typeof observer === 'string' && observer.trim() ? observer.trim() : undefined,
    };

    await session.save();
    res.json({ ok: true });
  } catch (error) {
    console.error('game-feedback error', error);
    res.status(500).json({ error: 'Failed to save feedback' });
  }
});



// POST /api/me/game-log
app.post('/api/me/game-log', requireAuth, async (req, res) => {
  try {
    const auth0Id = req.auth0Id;
    if (!auth0Id) return res.status(401).json({ error: 'Unauthorized' });

    const {
      type,
      correct,
      total,
      accuracy,
      xpAwarded,
      durationMs,
      meta,
      mode,
      skillTags,
      difficulty,
      responseTimeMs,
      hintsUsed,
      incorrectAttempts,
      feedback,
    } = req.body || {};
    if (!type || typeof correct !== 'number' || typeof total !== 'number') {
      return res.status(400).json({ error: 'Missing fields' });
    }

    // Get or create user to get userId (ObjectId)
    const user = await ensureUser(auth0Id, req.auth0Email || '', req.auth0Name || '');
    const userId = user._id;

    let session = await Session.findOne({ userId });
    if (!session) session = await Session.create({ userId });

    session.gameLogs.push({
      userId,
      type,
      mode: mode || meta?.mode || 'free-play',
      difficulty: difficulty || meta?.difficulty,
      skillTags: Array.isArray(skillTags || meta?.skillTags) ? (skillTags || meta?.skillTags) : [],
      level: meta?.level,
      correct,
      total,
      accuracy: Math.max(0, Math.min(100, Math.round(accuracy))),
      xpAwarded: xpAwarded || 0,
      durationMs: durationMs || 0,
      responseTimeMs: responseTimeMs || meta?.responseTimeMs || 0,
      hintsUsed: typeof hintsUsed === 'number' ? hintsUsed : meta?.hintsUsed || 0,
      incorrectAttempts: typeof incorrectAttempts === 'number' ? incorrectAttempts : meta?.incorrectAttempts || 0,
      feedback: feedback || meta?.feedback,
      at: new Date(),
      meta: meta || {},
    });

    session.points = (session.points || 0) + (xpAwarded || 0);
    session.totalGamesPlayed = (session.totalGamesPlayed || 0) + 1;

    await session.save();

    // Update accuracy using O(1) running counters + EMA (no need to scan all logs)
    const userDoc = await User.findById(userId); // we already ensured user earlier
    if (!userDoc.rewards) userDoc.rewards = {};

    // 1) Running totals
    const r = userDoc.rewards;
    r.correctSum = (r.correctSum || 0) + Number(correct || 0);
    r.totalSum = (r.totalSum || 0) + Number(total || 0);
    r.totalGamesPlayed = (r.totalGamesPlayed || 0) + 1;

    // 2) Bayesian smoothing over the lifetime data to prevent volatility on small N.
    //    Prior = Beta(α, β) ~ "expected accuracy" around 70% (tweakable).
    const alpha = 7;   // prior 'virtual' correct
    const beta = 3;   // prior 'virtual' incorrect
    const bayes = (r.correctSum + alpha) / (r.totalSum + alpha + beta); // 0..1

    // 3) Recency Exponential Moving Average on this game's accuracy.
    //    Good games nudge it up fast; bad games nudge it down fast.
    const thisGameAcc = total > 0 ? (correct / total) * 100 : 0;
    const k = 0.2; // smoothing factor (0.1 conservative, 0.3 snappier)
    r.accEMA = (r.accEMA ?? thisGameAcc) * (1 - k) + thisGameAcc * k; // in %

    // 4) Final displayed accuracy is a blend: mostly long-term (Bayes), some recent (EMA)
    const blended = 0.75 * (bayes * 100) + 0.25 * (r.accEMA || 0);
    r.accuracy = Math.round(Math.max(0, Math.min(100, blended)));

    // 5) Update quiz-specific stats if this is a quiz game
    if (type === 'quiz' && meta) {
      if (!r.quiz) r.quiz = {};
      const quiz = r.quiz;

      // Update overall quiz stats
      quiz.totalGamesPlayed = (quiz.totalGamesPlayed || 0) + 1;
      quiz.totalQuestions = (quiz.totalQuestions || 0) + Number(total || 0);
      quiz.totalCorrect = (quiz.totalCorrect || 0) + Number(correct || 0);
      quiz.totalXP = (quiz.totalXP || 0) + Number(xpAwarded || 0);

      // Update overall accuracy
      if (quiz.totalQuestions > 0) {
        quiz.overallAccuracy = Math.round((quiz.totalCorrect / quiz.totalQuestions) * 100);
      }

      // Update level tracking
      const levelReached = meta.level || 1;
      if (levelReached > (quiz.bestLevel || 0)) {
        quiz.bestLevel = levelReached;
      }
      // Update current level (use the level reached in this game)
      quiz.currentLevel = levelReached;

      // Update last played date
      const today = new Date();
      const todayYmd = today.toISOString().slice(0, 10);
      quiz.lastPlayedDate = todayYmd;

      // Update category performance
      if (meta.categoryPerformance && typeof meta.categoryPerformance === 'object') {
        if (!quiz.categoryPerformance) {
          quiz.categoryPerformance = new Map();
        } else if (!(quiz.categoryPerformance instanceof Map) && typeof quiz.categoryPerformance === 'object') {
          quiz.categoryPerformance = new Map(Object.entries(quiz.categoryPerformance));
        }

        Object.entries(meta.categoryPerformance).forEach(([category, stats]) => {
          if (stats && typeof stats === 'object') {
            const catStats = quiz.categoryPerformance.get(category) || {
              totalQuestions: 0,
              correctAnswers: 0,
              accuracy: 0,
              lastPlayedDate: todayYmd,
            };

            catStats.totalQuestions = (catStats.totalQuestions || 0) + (stats.totalQuestions || 0);
            catStats.correctAnswers = (catStats.correctAnswers || 0) + (stats.correctAnswers || 0);
            catStats.lastPlayedDate = todayYmd;

            if (catStats.totalQuestions > 0) {
              catStats.accuracy = Math.round((catStats.correctAnswers / catStats.totalQuestions) * 100);
            }

            quiz.categoryPerformance.set(category, catStats);
          }
        });
      }

      userDoc.markModified('rewards');
      userDoc.markModified('rewards.quiz');
      userDoc.markModified('rewards.quiz.categoryPerformance');
    }

    // 6) Update skill buckets when skills metadata is provided
    const skillsMap = getSkillsMap(r);

    // Process meta.skills array if provided (detailed skill breakdown)
    if (Array.isArray(meta?.skills) && meta.skills.length) {
      meta.skills.forEach((entry) => {
        const skillId = entry?.id;
        if (!skillId || !SKILL_LOOKUP[skillId]) return;
        const bucket = skillsMap.get(skillId) || {};
        updateSkillBucket(bucket, entry || {});
        skillsMap.set(skillId, bucket);
      });
      userDoc.markModified('rewards.skills');
    } else {
      // Fallback: Process skillTags to automatically create skill entries
      const tags = Array.isArray(skillTags) ? skillTags : (Array.isArray(meta?.skillTags) ? meta.skillTags : []);
      if (tags.length > 0) {
        // Map game type to default skill if no tags provided
        const typeToSkill = {
          'tap': 'timing-control',
          'match': 'color-recognition',
          'sort': 'category-sorting',
          'emoji': 'emotion-identification',
          'quiz': 'number-sense', // default, can be overridden by tags
        };

        // Use tags if provided, otherwise infer from game type
        const skillIds = tags.length > 0 ? tags : (typeToSkill[type] ? [typeToSkill[type]] : []);

        skillIds.forEach((skillId) => {
          if (!skillId || !SKILL_LOOKUP[skillId]) return;
          const bucket = skillsMap.get(skillId) || {};
          // Create skill entry from game results
          updateSkillBucket(bucket, {
            prompts: total,
            correct: correct,
            total: total,
            correctPrompts: correct,
            avgResponseMs: responseTimeMs || 0,
            attempts: total,
          });
          skillsMap.set(skillId, bucket);
        });
        userDoc.markModified('rewards.skills');
      }
    }

    // Update global level + label whenever skills change
    const globalLevel = computeGlobalLevel(skillsMap);
    r.globalLevel = globalLevel;
    r.levelLabel = levelLabelFor(globalLevel);
    userDoc.markModified('rewards');

    await userDoc.save();

    res.json({
      ok: true,
      points: session.points,
      totalGamesPlayed: session.totalGamesPlayed,
      last: session.gameLogs.at(-1),
      accuracy: r.accuracy, // send back for optional optimistic UI
      globalLevel: r.globalLevel,
    });
  } catch (e) {
    console.error('game-log error', e);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/me/stats', requireAuth, async (req, res) => {
  try {
    const auth0Id = req.auth0Id;
    const email = req.auth0Email || '';
    const name = req.auth0Name || '';
    const user = await ensureUser(auth0Id, email, name);
    const rewards = user.rewards || {};
    const skillsMap = getSkillsMap(rewards);
    let updated = false;

    let globalLevel = rewards.globalLevel;
    if (!globalLevel) {
      globalLevel = computeGlobalLevel(skillsMap);
      rewards.globalLevel = globalLevel;
      updated = true;
    }
    if (!rewards.levelLabel) {
      rewards.levelLabel = levelLabelFor(globalLevel);
      updated = true;
    }

    if (updated) {
      user.markModified('rewards');
      await user.save();
    }

    const recommendations = buildRecommendations({ skillsMap });
    const nextActions = buildNextActions({ skillsMap });

    res.json({
      xp: rewards?.xp ?? 0,
      coins: rewards?.coins ?? 0,
      hearts: rewards?.hearts ?? 5,
      streakDays: rewards?.streakDays ?? 0,
      bestStreak: rewards?.bestStreak ?? 0,
      lastPlayedDate: rewards?.lastPlayedDate ?? null,
      accuracy: rewards?.accuracy ?? 0,
      globalLevel,
      levelLabel: rewards.levelLabel,
      recommendations,
      nextActions,
    });
  } catch (error) {
    console.error('stats endpoint error', error);
    res.status(500).json({ error: 'Failed to load stats' });
  }
});

app.get('/api/me/skill-profile', requireAuth, async (req, res) => {
  try {
    const auth0Id = req.auth0Id;
    const email = req.auth0Email || '';
    const name = req.auth0Name || '';
    const user = await ensureUser(auth0Id, email, name);
    const rewards = user.rewards || {};
    const skillsMap = getSkillsMap(rewards);

    const serializeBucket = (bucket) => {
      if (!bucket) return null;
      return {
        totalPrompts: bucket.totalPrompts || 0,
        correctPrompts: bucket.correctPrompts || 0,
        accuracy: bucket.accuracy || 0,
        avgResponseMs: bucket.avgResponseMs || 0,
        attempts: bucket.attempts || 0,
        ewmaAccuracy: bucket.ewmaAccuracy || 0,
        streak: bucket.streak || 0,
        bestStreak: bucket.bestStreak || 0,
        level: bucket.level || 1,
        trend: bucket.trend || 0,
        lastPlayedDate: bucket.lastPlayedDate || null,
      };
    };

    const payload = Object.values(SKILL_LOOKUP).map((skill) => {
      const bucket = skillsMap.get ? skillsMap.get(skill.id) : skillsMap[skill.id];
      return {
        id: skill.id,
        title: skill.title,
        description: skill.description,
        icon: skill.icon,
        tags: skill.tags,
        stats: serializeBucket(bucket),
      };
    });

    res.json({ skills: payload, updatedAt: new Date().toISOString() });
  } catch (error) {
    console.error('skill-profile error', error);
    res.status(500).json({ error: 'Failed to load skill profile' });
  }
});

app.get('/api/me/insights', requireAuth, async (req, res) => {
  try {
    const auth0Id = req.auth0Id;
    const email = req.auth0Email || '';
    const name = req.auth0Name || '';
    const range = typeof req.query?.range === 'string' ? req.query.range : '30d';
    const user = await ensureUser(auth0Id, email, name);
    const insights = await buildInsights({ userId: user._id, range, rewards: user.rewards });
    res.json(insights);
  } catch (error) {
    console.error('insights endpoint error', error);
    res.status(500).json({ error: 'Failed to load insights' });
  }
});

app.post('/api/games/record', requireAuth, async (req, res) => {
  const { pointsEarned = 10, coins = 0, xp = 10 } = req.body || {};
  const today = new Date();
  const todayYmd = today.toISOString().slice(0, 10);

  const user = await ensureUser(req.auth0Id, req.auth0Email || '', req.auth0Name || '');
  const rewards = user.rewards || {};

  if (rewards.lastPlayedDate) {
    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);
    const yYmd = yesterday.toISOString().slice(0, 10);
    if (rewards.lastPlayedDate === todayYmd) {
      // same day, keep streak
    } else if (rewards.lastPlayedDate === yYmd) {
      rewards.streakDays = (rewards.streakDays || 0) + 1;
    } else {
      rewards.streakDays = 1;
    }
  } else {
    rewards.streakDays = 1;
  }

  rewards.lastPlayedDate = todayYmd;
  rewards.xp = (rewards.xp || 0) + Number(xp || pointsEarned || 0);
  rewards.coins = (rewards.coins || 0) + Number(coins || 0);
  rewards.hearts = Math.max(0, Math.min(5, rewards.hearts ?? 5));
  // Track best streak
  const currentStreak = rewards.streakDays || 0;
  const best = rewards.bestStreak || 0;
  if (currentStreak > best) {
    rewards.bestStreak = currentStreak;
  }
  user.rewards = rewards;
  await user.save();
  res.json({
    xp: rewards.xp,
    coins: rewards.coins,
    hearts: rewards.hearts,
    streakDays: rewards.streakDays,
    lastPlayedDate: rewards.lastPlayedDate,
  });
});

// Favorites
app.get('/api/me/favorites', requireAuth, async (req, res) => {
  const user = await ensureUser(req.auth0Id, req.auth0Email || '', req.auth0Name || '');
  res.json({ favorites: user.favorites || [] });
});

app.post('/api/me/favorites/toggle', requireAuth, async (req, res) => {
  const { tileId } = req.body || {};
  if (!tileId) return res.status(400).json({ error: 'tileId required' });
  const user = await ensureUser(req.auth0Id, req.auth0Email || '', req.auth0Name || '');
  const set = new Set(user.favorites || []);
  let isFavorite;
  if (set.has(tileId)) {
    set.delete(tileId);
    isFavorite = false;
  } else {
    set.add(tileId);
    isFavorite = true;
  }
  user.favorites = Array.from(set);
  await user.save();
  res.json({ ok: true, isFavorite, favorites: user.favorites });
});

// Custom tiles
app.get('/api/me/custom-tiles', requireAuth, async (req, res) => {
  const user = await ensureUser(req.auth0Id, req.auth0Email || '', req.auth0Name || '');
  res.json({ tiles: user.customTiles || [] });
});

app.post('/api/me/custom-tiles', requireAuth, async (req, res) => {
  const { id, label, emoji, imageUrl } = req.body || {};
  if (!id || !label) return res.status(400).json({ error: 'id and label required' });
  const user = await ensureUser(req.auth0Id, req.auth0Email || '', req.auth0Name || '');
  // prevent duplicates by id
  const exists = (user.customTiles || []).some(t => t.id === id);
  if (exists) return res.status(409).json({ error: 'id already exists' });
  user.customTiles.push({ id, label, emoji, imageUrl });
  await user.save();
  res.json({ ok: true, tile: { id, label, emoji, imageUrl } });
});

app.put('/api/me/custom-tiles/:id', requireAuth, async (req, res) => {
  const { id } = req.params;
  const { label, emoji, imageUrl } = req.body || {};
  if (!label) return res.status(400).json({ error: 'label required' });
  const user = await ensureUser(req.auth0Id, req.auth0Email || '', req.auth0Name || '');
  const tileIndex = (user.customTiles || []).findIndex(t => t.id === id);
  if (tileIndex === -1) return res.status(404).json({ error: 'tile not found' });

  // Update the tile
  user.customTiles[tileIndex] = {
    ...user.customTiles[tileIndex],
    label,
    emoji,
    imageUrl
  };
  await user.save();
  res.json({ ok: true, tile: user.customTiles[tileIndex] });
});

app.delete('/api/me/custom-tiles/:id', requireAuth, async (req, res) => {
  const { id } = req.params;
  const user = await ensureUser(req.auth0Id, req.auth0Email || '', req.auth0Name || '');
  user.customTiles = (user.customTiles || []).filter(t => t.id !== id);
  await user.save();
  res.json({ ok: true });
});

// Contact messages
app.post('/api/me/contact', requireAuth, async (req, res) => {
  try {
    const auth0Id = req.auth0Id;
    if (!auth0Id) return res.status(401).json({ ok: false, error: 'Unauthorized' });
    const { subject, message } = req.body || {};
    if (!message || typeof message !== 'string' || !message.trim()) {
      return res.status(400).json({ ok: false, error: 'message required' });
    }
    const doc = await Message.create({
      userAuth0Id: auth0Id,
      email: req.auth0Email || '',
      name: req.auth0Name || '',
      subject: subject || '',
      message: message.trim(),
    });
    res.json({ ok: true, id: doc._id });
  } catch (e) {
    console.error('contact error', e);
    res.status(500).json({ ok: false, error: 'Server error' });
  }
});

const port = process.env.PORT || 4000;

async function startServer() {
  try {
    await mongoose.connect(mongoUri);
    console.log('Connected to MongoDB');
    app.listen(port, '0.0.0.0', () => console.log(API listening on 0.0.0.0:${port}));
  } catch (error) {
    console.error('MongoDB connection error:', error);
    process.exit(1);
  }
}

startServer();

const port = process.env.PORT || 4000;

async function startServer() {
  try {
    await mongoose.connect(mongoUri);
    console.log('Connected to MongoDB');
    app.listen(port, '0.0.0.0', () => console.log(API listening on 0.0.0.0:${port}));
  } catch (error) {
    console.error('MongoDB connection error:', error);
    process.exit(1);
  }
}

startServer();