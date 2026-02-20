import crypto from 'crypto';
import express from 'express';
import Razorpay from 'razorpay';
import { Payment } from '../models/Payment.js';
import { Subscription } from '../models/Subscription.js';
import { User } from '../models/User.js';

const router = express.Router();

// Log that router is being loaded
console.log('[SUBSCRIPTION ROUTER] Router module loaded');

// Middleware to ensure CORS headers on all responses from this router
router.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  }
  next();
});

// Test route to verify router is working
router.get('/test', (req, res) => {
  console.log('[SUBSCRIPTION ROUTER] Test route hit');
  res.json({ ok: true, message: 'Subscription router is working' });
});

// Initialize Razorpay instance
// Keys should be in environment variables: RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET
// If keys are not set, Razorpay will still initialize but API calls will fail
let razorpay;
const keyId = process.env.RAZORPAY_KEY_ID;
const keySecret = process.env.RAZORPAY_KEY_SECRET;
const hasKeys = keyId && keySecret && keyId.trim() !== '' && keySecret.trim() !== '';

console.log('[SUBSCRIPTION ROUTER] Initializing Razorpay...');
console.log('[SUBSCRIPTION ROUTER] RAZORPAY_KEY_ID:', keyId ? (keyId.substring(0, 10) + '...') : 'NOT SET');
console.log('[SUBSCRIPTION ROUTER] RAZORPAY_KEY_SECRET:', keySecret ? 'SET (hidden)' : 'NOT SET');
console.log('[SUBSCRIPTION ROUTER] Has valid keys:', hasKeys);

try {
  razorpay = new Razorpay({
    key_id: keyId || '',
    key_secret: keySecret || '',
  });
  if (hasKeys) {
    console.log('[SUBSCRIPTION ROUTER] ✅ Razorpay initialized with valid keys');
  } else {
    console.log('[SUBSCRIPTION ROUTER] ⚠️ Razorpay initialized but keys are missing (localhost mode)');
  }
} catch (error) {
  console.error('[SUBSCRIPTION ROUTER] ❌ Failed to initialize Razorpay:', error);
  // Create a dummy instance to prevent module load failure
  razorpay = { plans: {}, customers: {}, subscriptions: {}, payments: {} };
}

// Monthly subscription plan configuration
const MONTHLY_PLAN_AMOUNT = 5900; // ₹59.00 in paise
const MONTHLY_PLAN_INTERVAL = 1; // 1 month
const TRIAL_DAYS = 7;

// TEMPORARY: Set to true to test Paywall (disable free access for testing)
// TODO: Remove this and use DISABLE_FREE_ACCESS_FOR_TESTING env variable instead
// Set to false in production to enable free access for employees/boss
const FORCE_DISABLE_FREE_ACCESS = process.env.DISABLE_FREE_ACCESS_FOR_TESTING === 'true';

// Whitelist: IDs that should always have free access (employees, boss, etc.)
// Add Auth0 IDs here or via FREE_ACCESS_IDS env variable (comma-separated)
// 
// HOW TO FIND AUTH0 ID:
// 1. Check browser console when user logs in
// 2. Check Auth0 dashboard → Users → Select user → Copy "User ID"
// 3. Format: Usually starts with "auth0|" followed by alphanumeric string
//
// EXAMPLES:
// - Boss: 'auth0|60f7b3c4d5e6f7a8b9c0d1e2'
// - Employee 1: 'auth0|70f8c4d5e6f7a8b9c0d1e2f3'
// - Employee 2: 'auth0|80f9d5e6f7a8b9c0d1e2f3a4'
//
// OR set in backend .env file:
// FREE_ACCESS_IDS=auth0|boss_id,auth0|employee1_id,auth0|employee2_id
const FREE_ACCESS_IDS = [
  'auth0_test_user', // Default test user from server.js
  'dev_local_tester', // Fallback from utils/api.ts for localhost
  'manjot1104@gmail.com', // Added for free subscription access
  'nonavi080@gmail.com', // Added for free subscription access
  // Add employee/boss Auth0 IDs here:
  // 'auth0|your_boss_id_here',
  // 'auth0|employee1_id_here',
  // 'auth0|employee2_id_here',
  ...(process.env.FREE_ACCESS_IDS ? process.env.FREE_ACCESS_IDS.split(',').map(id => id.trim()).filter(Boolean) : []),
].filter(Boolean); // Remove null/undefined/empty

// Email whitelist: Emails that should always have free access
// Add emails here or via FREE_ACCESS_EMAILS env variable (comma-separated)
// 
// EXAMPLES:
// - manjot1104@gmail.com
// - boss@company.com
//
// OR set in backend .env file:
// FREE_ACCESS_EMAILS=manjot1104@gmail.com,boss@company.com,employee1@company.com
const FREE_ACCESS_EMAILS = [
  'manjot1104@gmail.com', // Added for free subscription access
  'nonavi080@gmail.com', // Added for free subscription access
  ...(process.env.FREE_ACCESS_EMAILS ? process.env.FREE_ACCESS_EMAILS.split(',').map(email => email.trim().toLowerCase()).filter(Boolean) : []),
].filter(Boolean); // Remove null/undefined/empty

/**
 * Helper: Get or create subscription for user
 * Automatically starts 7-day free trial for new users
 * Skips for whitelisted users
 */
async function getOrCreateSubscription(auth0Id, userId) {
  // Skip subscription creation for whitelisted users
  if (await hasFreeAccess(auth0Id)) {
    console.log(`User ${auth0Id} has free access - skipping subscription creation`);
    return null;
  }
  
  let subscription = await Subscription.findOne({ auth0Id });
  
  if (!subscription) {
    // New user - start free trial
    const now = new Date();
    const trialEndDate = new Date(now);
    trialEndDate.setDate(trialEndDate.getDate() + TRIAL_DAYS);
    
    subscription = await Subscription.create({
      userId,
      auth0Id,
      trialStartDate: now,
      trialEndDate,
      trialUsed: true,
      status: 'trial',
    });
    
    console.log(`Started 7-day free trial for user ${auth0Id}`);
  }
  
  return subscription;
}

/**
 * Helper: Check if user has free access (whitelisted)
 * Also checks for localhost/development environment
 * 
 * IMPORTANT: If Razorpay keys are not configured, ALL users get free access (for localhost development)
 */
async function hasFreeAccess(auth0Id) {
  // Check if free access is disabled for testing (to test Paywall)
  // Check both environment variable and temporary hardcoded flag
  const disableFreeAccess = FORCE_DISABLE_FREE_ACCESS || process.env.DISABLE_FREE_ACCESS_FOR_TESTING === 'true';
  console.log(`[FREE ACCESS] FORCE_DISABLE_FREE_ACCESS: ${FORCE_DISABLE_FREE_ACCESS}, DISABLE_FREE_ACCESS_FOR_TESTING env: "${process.env.DISABLE_FREE_ACCESS_FOR_TESTING}", Final: ${disableFreeAccess}`);
  
  if (disableFreeAccess) {
    console.log(`[FREE ACCESS] Free access disabled for testing - NO free access (whitelist ignored)`);
    // When testing Paywall, ignore whitelist completely
    return false;
  }
  
  // If no auth0Id, allow access (development scenario)
  if (!auth0Id || auth0Id === 'undefined' || auth0Id === 'null' || auth0Id === '') {
    console.log(`[FREE ACCESS] No auth0Id provided - allowing free access for development`);
    return true;
  }
  
  // Check Auth0 ID whitelist
  const isWhitelistedById = FREE_ACCESS_IDS.includes(auth0Id);
  
  // Check email whitelist by looking up user in database
  let isWhitelistedByEmail = false;
  if (!isWhitelistedById && FREE_ACCESS_EMAILS.length > 0) {
    try {
      const user = await User.findOne({ auth0Id });
      if (user && user.email) {
        const userEmail = user.email.toLowerCase().trim();
        isWhitelistedByEmail = FREE_ACCESS_EMAILS.includes(userEmail);
        if (isWhitelistedByEmail) {
          console.log(`[FREE ACCESS] User ${auth0Id} (${userEmail}) is whitelisted by email`);
        }
      }
    } catch (error) {
      console.error(`[FREE ACCESS] Error checking email whitelist for ${auth0Id}:`, error);
      // Continue with other checks if email lookup fails
    }
  }
  
  const isWhitelisted = isWhitelistedById || isWhitelistedByEmail;
  
  // Also allow if running on localhost (development)
  // If Razorpay keys are NOT configured, allow free access for everyone (localhost development)
  const hasRazorpayKeys = process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET;
  
  // If no Razorpay keys configured, it's definitely localhost - allow free access
  if (!hasRazorpayKeys) {
    console.log(`[FREE ACCESS] No Razorpay keys configured - allowing free access for localhost development`);
    return true;
  }
  
  // Check if we're in development mode (localhost)
  // Grant free access if:
  // 1. NODE_ENV is not 'production' (development mode)
  // 2. OR Razorpay keys are test keys
  const isTestKey = process.env.RAZORPAY_KEY_ID.includes('test') || 
                    process.env.RAZORPAY_KEY_ID.includes('rzp_test');
  const isDevelopment = process.env.NODE_ENV !== 'production';
  const isLocalhost = isTestKey || isDevelopment;
  
  // Log for debugging
  const hasAccess = isWhitelisted || isLocalhost;
  if (hasAccess) {
    console.log(`[FREE ACCESS] User ${auth0Id} has free access. Whitelisted (ID): ${isWhitelistedById}, Whitelisted (Email): ${isWhitelistedByEmail}, Localhost: ${isLocalhost}, HasKeys: ${hasRazorpayKeys}, IsTestKey: ${isTestKey}`);
  } else {
    console.log(`[FREE ACCESS] User ${auth0Id} does NOT have free access. Whitelisted (ID): ${isWhitelistedById}, Whitelisted (Email): ${isWhitelistedByEmail}, Localhost: ${isLocalhost}`);
  }
  
  return hasAccess;
}

/**
 * Helper: Check if subscription is active (trial or paid)
 */
async function checkSubscriptionStatus(auth0Id) {
  // Check if user has free access (whitelisted)
  if (await hasFreeAccess(auth0Id)) {
    return {
      hasAccess: true,
      status: 'free',
      isTrial: false,
      isActive: true,
      trialEndDate: null,
      subscriptionEndDate: null,
      nextBillingDate: null,
      razorpaySubscriptionId: null,
      isFreeAccess: true, // Flag to indicate free access
    };
  }
  
  const subscription = await Subscription.findOne({ auth0Id });
  
  if (!subscription) {
    return {
      hasAccess: false,
      status: 'none',
      isTrial: false,
      isActive: false,
      trialEndDate: null,
      subscriptionEndDate: null,
    };
  }
  
  const now = new Date();
  const isTrialActive = subscription.isTrialActive();
  const isTrialExpired = subscription.isTrialExpired();
  
  // For paid subscriptions, verify that payment actually exists
  // If status is 'active' but no payment found, it's invalid - reset to 'created' or 'expired'
  let isPaidActive = false;
  if (subscription.status === 'active' && subscription.subscriptionEndDate && subscription.subscriptionEndDate > now) {
    // Check if there's actually a payment for this subscription
    if (subscription.razorpaySubscriptionId) {
      const { Payment } = await import('../models/Payment.js');
      const payment = await Payment.findOne({
        razorpaySubscriptionId: subscription.razorpaySubscriptionId,
        status: { $in: ['captured', 'authorized'] }, // Only successful payments
      });
      
      if (payment) {
        isPaidActive = true;
      } else {
        // Subscription marked as 'active' but no payment found - this is invalid
        console.warn(`[SUBSCRIPTION STATUS] Subscription ${subscription._id} is marked 'active' but no payment found. Resetting to 'created'.`);
        subscription.status = 'created';
        subscription.subscriptionEndDate = null;
        subscription.nextBillingDate = null;
        await subscription.save().catch(err => {
          console.error('[SUBSCRIPTION STATUS] Failed to reset invalid subscription:', err);
        });
      }
    } else {
      // No Razorpay subscription ID - can't be a valid paid subscription
      console.warn(`[SUBSCRIPTION STATUS] Subscription ${subscription._id} is marked 'active' but has no Razorpay subscription ID. Resetting.`);
      subscription.status = 'expired';
      subscription.subscriptionEndDate = null;
      await subscription.save().catch(err => {
        console.error('[SUBSCRIPTION STATUS] Failed to reset invalid subscription:', err);
      });
    }
  }
  
  const hasAccess = isTrialActive || isPaidActive;
  
  // Determine the actual status to return
  // If trial has expired but status is still 'trial', return 'expired'
  let actualStatus = subscription.status;
  if (isTrialExpired && subscription.status === 'trial') {
    actualStatus = 'expired';
    // Optionally update the database status (async, don't wait)
    subscription.status = 'expired';
    subscription.save().catch(err => {
      console.error('[SUBSCRIPTION STATUS] Failed to update expired trial status:', err);
    });
  }
  
  return {
    hasAccess,
    status: actualStatus,
    isTrial: isTrialActive,
    isActive: hasAccess,
    trialEndDate: subscription.trialEndDate,
    subscriptionEndDate: subscription.subscriptionEndDate,
    nextBillingDate: subscription.nextBillingDate,
    razorpaySubscriptionId: subscription.razorpaySubscriptionId,
  };
}

/**
 * POST /api/subscription/create-subscription
 * Creates a Razorpay subscription for the user
 * Called when user wants to subscribe after trial ends
 */
router.post('/create-subscription', async (req, res) => {
  console.log('[SUBSCRIPTION ROUTER] POST /create-subscription route hit');
  try {
    const auth0Id = req.auth0Id;
    if (!auth0Id) {
      return res.status(401).json({ ok: false, error: 'Unauthorized' });
    }
    
    // Check if user has free access - don't create subscription
    if (await hasFreeAccess(auth0Id)) {
      console.log(`[CREATE SUBSCRIPTION] User ${auth0Id} has free access - skipping subscription creation`);
      return res.json({
        ok: true,
        message: 'User has free access - subscription not needed',
        hasFreeAccess: true,
      });
    }
    
    const user = await User.findOne({ auth0Id });
    if (!user) {
      return res.status(404).json({ ok: false, error: 'User not found' });
    }
    
    // Get or create subscription
    const subscription = await getOrCreateSubscription(auth0Id, user._id);
    
    // Safety check: subscription should not be null at this point (free access already checked)
    if (!subscription) {
      console.error(`[CREATE SUBSCRIPTION] Unexpected: subscription is null for user ${auth0Id}`);
      return res.status(500).json({
        ok: false,
        error: 'Failed to get or create subscription',
      });
    }
    
    // Check if already has active subscription
    if (subscription.status === 'active' && subscription.isActive()) {
      return res.json({
        ok: true,
        message: 'Subscription already active',
        subscriptionId: subscription.razorpaySubscriptionId,
      });
    }
    
    // If there's an existing 'created' subscription with Razorpay ID, cancel it first
    // This handles cases where previous subscription creation failed or has past start_at
    if (subscription.status === 'created' && subscription.razorpaySubscriptionId) {
      console.log(`[CREATE SUBSCRIPTION] Found existing 'created' subscription ${subscription.razorpaySubscriptionId} - cancelling to create fresh one`);
      console.log(`[CREATE SUBSCRIPTION] Old plan ID stored in DB: ${subscription.razorpayPlanId}`);
      try {
        // Cancel the old subscription in Razorpay
        await razorpay.subscriptions.cancel(subscription.razorpaySubscriptionId);
        console.log(`[CREATE SUBSCRIPTION] Cancelled old subscription ${subscription.razorpaySubscriptionId}`);
      } catch (error) {
        // If already cancelled or doesn't exist, continue
        console.log(`[CREATE SUBSCRIPTION] Could not cancel old subscription (may already be cancelled): ${error.message}`);
      }
      // Clear the old subscription ID and plan ID so we can create a new one with correct plan
      subscription.razorpaySubscriptionId = null;
      subscription.razorpayPlanId = null;
      await subscription.save();
      console.log(`[CREATE SUBSCRIPTION] Cleared old subscription data - will create new one with correct plan (₹59)`);
    }
    
    // Check if Razorpay keys are configured
    const keyId = process.env.RAZORPAY_KEY_ID;
    const keySecret = process.env.RAZORPAY_KEY_SECRET;
    const hasRazorpayKeys = keyId && keySecret && keyId.trim() !== '' && keySecret.trim() !== '';
    
    // Debug logging
    console.log('[CREATE SUBSCRIPTION] Checking Razorpay keys...');
    console.log('[CREATE SUBSCRIPTION] RAZORPAY_KEY_ID exists:', !!keyId);
    console.log('[CREATE SUBSCRIPTION] RAZORPAY_KEY_ID value:', keyId ? (keyId.substring(0, 10) + '...') : 'NOT SET');
    console.log('[CREATE SUBSCRIPTION] RAZORPAY_KEY_SECRET exists:', !!keySecret);
    console.log('[CREATE SUBSCRIPTION] Has valid keys:', hasRazorpayKeys);
    
    if (!hasRazorpayKeys) {
      console.log('[CREATE SUBSCRIPTION] Razorpay keys not configured - returning mock response for localhost development');
      console.log('[CREATE SUBSCRIPTION] Please set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET in backend/.env file');
      // For localhost development without Razorpay keys, return mock data
      return res.json({
        ok: true,
        subscriptionId: 'mock_subscription_' + Date.now(),
        planId: 'mock_plan_id',
        customerId: 'mock_customer_id',
        amount: MONTHLY_PLAN_AMOUNT / 100,
        currency: 'INR',
        mock: true, // Flag to indicate this is a mock response
      });
    }
    
    console.log('[CREATE SUBSCRIPTION] Razorpay keys found - proceeding with real subscription creation');
    
    // Create Razorpay plan if it doesn't exist (idempotent)
    let planId = process.env.RAZORPAY_PLAN_ID;
    
    console.log('[CREATE SUBSCRIPTION] Checking for RAZORPAY_PLAN_ID in env...');
    console.log('[CREATE SUBSCRIPTION] RAZORPAY_PLAN_ID from env:', planId || 'NOT SET');
    console.log('[CREATE SUBSCRIPTION] MONTHLY_PLAN_AMOUNT:', MONTHLY_PLAN_AMOUNT, 'paise (₹' + (MONTHLY_PLAN_AMOUNT / 100) + ')');
    
    if (!planId) {
      // Create plan dynamically (only if not set in env)
      console.log('[CREATE SUBSCRIPTION] RAZORPAY_PLAN_ID not set - creating new plan with amount:', MONTHLY_PLAN_AMOUNT, 'paise');
      try {
        const plan = await razorpay.plans.create({
          period: 'monthly',
          interval: MONTHLY_PLAN_INTERVAL,
          item: {
            name: 'Monthly Therapy Access',
            description: 'Monthly subscription for Therapy Progress access',
            amount: MONTHLY_PLAN_AMOUNT, // 5900 paise = ₹59
            currency: 'INR',
          },
        });
        planId = plan.id;
        console.log('[CREATE SUBSCRIPTION] ✅ Created new Razorpay plan:', planId);
        console.log('[CREATE SUBSCRIPTION] Plan amount:', plan.item.amount, 'paise (₹' + (plan.item.amount / 100) + ')');
        console.log('[CREATE SUBSCRIPTION] ⚠️ IMPORTANT: Save this plan ID in .env file: RAZORPAY_PLAN_ID=' + planId);
      } catch (error) {
        console.error('[CREATE SUBSCRIPTION] ❌ Failed to create Razorpay plan:', error);
        console.error('[CREATE SUBSCRIPTION] Error details:', error.message);
        // If plan already exists, try to find it
        // In production, you should set RAZORPAY_PLAN_ID in env vars
        return res.status(500).json({
          ok: false,
          error: 'Failed to create subscription plan. Please set RAZORPAY_PLAN_ID in environment variables.',
          details: error.message,
        });
      }
    } else {
      console.log('[CREATE SUBSCRIPTION] Using existing plan ID from env:', planId);
      // Verify the plan amount by fetching it from Razorpay
      try {
        const existingPlan = await razorpay.plans.fetch(planId);
        console.log('[CREATE SUBSCRIPTION] Existing plan details:', {
          id: existingPlan.id,
          amount: existingPlan.item.amount,
          amountInRupees: '₹' + (existingPlan.item.amount / 100),
          period: existingPlan.period,
        });
        if (existingPlan.item.amount !== MONTHLY_PLAN_AMOUNT) {
          console.warn('[CREATE SUBSCRIPTION] ⚠️ WARNING: Plan amount mismatch!');
          console.warn('[CREATE SUBSCRIPTION] Plan in Razorpay:', existingPlan.item.amount, 'paise (₹' + (existingPlan.item.amount / 100) + ')');
          console.warn('[CREATE SUBSCRIPTION] Expected amount:', MONTHLY_PLAN_AMOUNT, 'paise (₹' + (MONTHLY_PLAN_AMOUNT / 100) + ')');
          console.warn('[CREATE SUBSCRIPTION] 💡 Solution: Remove RAZORPAY_PLAN_ID from .env to create new plan with correct amount');
        }
      } catch (planError) {
        console.error('[CREATE SUBSCRIPTION] Failed to fetch plan details:', planError);
      }
    }
    
    // Create Razorpay customer
    let customerId = subscription.razorpayCustomerId;
    if (!customerId) {
      const customer = await razorpay.customers.create({
        name: user.name || user.email,
        email: user.email,
        contact: user.phoneNumber ? `${user.phoneCountryCode}${user.phoneNumber}` : undefined,
      });
      customerId = customer.id;
      subscription.razorpayCustomerId = customerId;
    }
    
    // Create Razorpay subscription
    // Note: Subscription is created in 'created' state, will become 'active' only after first payment
    // Set start_at to current time + 30 seconds to ensure it's always in the future
    // This prevents "start time is past" errors while allowing immediate payment
    const now = Math.floor(Date.now() / 1000);
    const startAt = now + 30; // 30 seconds from now - enough buffer for checkout to open
    
    const razorpaySubscription = await razorpay.subscriptions.create({
      plan_id: planId,
      customer_notify: 1,
      total_count: 12, // 12 months = 1 year (or set to null for indefinite)
      start_at: startAt, // Set to 2 minutes from now to avoid past time errors
      notes: {
        auth0Id,
        userId: user._id.toString(),
      },
    });
    
    console.log(`[CREATE SUBSCRIPTION] Created subscription with start_at: ${new Date(startAt * 1000).toISOString()}`);
    
    console.log(`[CREATE SUBSCRIPTION] Created Razorpay subscription ${razorpaySubscription.id} with status: ${razorpaySubscription.status}`);
    
    // Verify the plan amount by fetching it from Razorpay
    try {
      const planDetails = await razorpay.plans.fetch(planId);
      console.log(`[CREATE SUBSCRIPTION] ✅ Verified plan amount:`, {
        planId: planId,
        planAmount: planDetails.item.amount,
        planAmountInRupees: '₹' + (planDetails.item.amount / 100),
        expectedAmount: MONTHLY_PLAN_AMOUNT,
        expectedAmountInRupees: '₹' + (MONTHLY_PLAN_AMOUNT / 100),
      });
      
      if (planDetails.item.amount !== MONTHLY_PLAN_AMOUNT) {
        console.error(`[CREATE SUBSCRIPTION] ❌ CRITICAL: Plan amount mismatch!`);
        console.error(`[CREATE SUBSCRIPTION] Plan in Razorpay: ${planDetails.item.amount} paise (₹${planDetails.item.amount / 100})`);
        console.error(`[CREATE SUBSCRIPTION] Expected: ${MONTHLY_PLAN_AMOUNT} paise (₹${MONTHLY_PLAN_AMOUNT / 100})`);
        console.error(`[CREATE SUBSCRIPTION] 💡 This subscription will show WRONG amount (₹${planDetails.item.amount / 100}) in checkout!`);
        console.error(`[CREATE SUBSCRIPTION] 💡 Solution: Remove RAZORPAY_PLAN_ID from .env and restart server to create new plan`);
      } else {
        console.log(`[CREATE SUBSCRIPTION] ✅ Plan amount is correct: ₹${MONTHLY_PLAN_AMOUNT / 100}`);
      }
    } catch (verifyError) {
      console.warn(`[CREATE SUBSCRIPTION] Could not verify plan amount:`, verifyError.message);
    }
    
    // Update subscription in database
    // IMPORTANT: Do NOT set status to 'active' here - it should only be active after payment is verified
    // Razorpay subscription starts as 'created' and becomes 'active' after first payment
    subscription.razorpaySubscriptionId = razorpaySubscription.id;
    subscription.razorpayPlanId = planId;
    subscription.status = 'created'; // Set to 'created' - will become 'active' only after payment verification
    subscription.subscriptionStartDate = null; // Will be set after payment
    subscription.nextBillingDate = null; // Will be set after payment
    subscription.subscriptionEndDate = null; // Will be set after payment - NO ACCESS until payment verified
    
    await subscription.save();
    
    console.log(`[CREATE SUBSCRIPTION] Subscription saved with status 'created' - waiting for payment verification`);
    
    console.log(`Created Razorpay subscription ${razorpaySubscription.id} for user ${auth0Id}`);
    
    res.json({
      ok: true,
      subscriptionId: razorpaySubscription.id,
      planId,
      customerId,
      amount: MONTHLY_PLAN_AMOUNT / 100, // Convert paise to rupees
      currency: 'INR',
    });
  } catch (error) {
    console.error('Failed to create subscription:', error);
    res.status(500).json({
      ok: false,
      error: error.message || 'Failed to create subscription',
    });
  }
});

/**
 * POST /api/subscription/verify-payment
 * Verifies payment signature and updates subscription status
 */
router.post('/verify-payment', async (req, res) => {
  try {
    const auth0Id = req.auth0Id;
    if (!auth0Id) {
      return res.status(401).json({ ok: false, error: 'Unauthorized' });
    }
    
    const { razorpay_payment_id, razorpay_subscription_id, razorpay_signature } = req.body;
    
    if (!razorpay_payment_id || !razorpay_subscription_id || !razorpay_signature) {
      return res.status(400).json({
        ok: false,
        error: 'Missing payment verification data',
      });
    }
    
    // Verify signature
    const text = `${razorpay_subscription_id}|${razorpay_payment_id}`;
    const generatedSignature = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(text)
      .digest('hex');
    
    if (generatedSignature !== razorpay_signature) {
      return res.status(400).json({
        ok: false,
        error: 'Invalid payment signature',
      });
    }
    
    // Fetch payment details from Razorpay
    const payment = await razorpay.payments.fetch(razorpay_payment_id);
    console.log(`[VERIFY PAYMENT] Payment fetched: ${razorpay_payment_id}, status: ${payment.status}`);
    
    // Update subscription
    const subscription = await Subscription.findOne({
      razorpaySubscriptionId: razorpay_subscription_id,
    });
    
    if (!subscription) {
      console.error(`[VERIFY PAYMENT] Subscription not found for Razorpay ID: ${razorpay_subscription_id}`);
      return res.status(404).json({
        ok: false,
        error: 'Subscription not found',
      });
    }
    
    console.log(`[VERIFY PAYMENT] Found subscription ${subscription._id}, current status: ${subscription.status}`);
    
    // Update subscription to active
    subscription.status = 'active';
    subscription.subscriptionStartDate = new Date(payment.created_at * 1000);
    
    // Calculate next billing date (1 month from payment)
    const nextBilling = new Date(payment.created_at * 1000);
    nextBilling.setMonth(nextBilling.getMonth() + 1);
    subscription.nextBillingDate = nextBilling;
    subscription.subscriptionEndDate = nextBilling;
    
    await subscription.save();
    console.log(`[VERIFY PAYMENT] Subscription ${subscription._id} updated to 'active', end date: ${subscription.subscriptionEndDate}`);
    
    // Record payment
    const paymentRecord = await Payment.findOneAndUpdate(
      { razorpayPaymentId: razorpay_payment_id },
      {
        userId: subscription.userId,
        auth0Id: subscription.auth0Id || auth0Id,
        subscriptionId: subscription._id,
        razorpayPaymentId: razorpay_payment_id,
        razorpaySubscriptionId: razorpay_subscription_id,
        amount: payment.amount,
        amountInRupees: payment.amount / 100,
        currency: payment.currency,
        status: payment.status === 'captured' ? 'captured' : 'authorized', // Ensure proper status
        method: payment.method,
        paidAt: payment.captured_at ? new Date(payment.captured_at * 1000) : new Date(),
        webhookReceived: false,
      },
      { upsert: true, new: true }
    );
    
    console.log(`[VERIFY PAYMENT] Payment record saved: ${paymentRecord._id}, status: ${paymentRecord.status}`);
    
    res.json({
      ok: true,
      message: 'Payment verified successfully',
      subscriptionStatus: subscription.status,
      hasAccess: true,
    });
  } catch (error) {
    console.error('Failed to verify payment:', error);
    res.status(500).json({
      ok: false,
      error: error.message || 'Failed to verify payment',
    });
  }
});

/**
 * GET /api/subscription/status
 * Returns current subscription status for the user
 * Automatically creates trial for new users
 */
router.get('/status', async (req, res) => {
  // Track if response has been sent to prevent double responses
  let responseSent = false;
  
  const sendResponse = (statusCode, data) => {
    if (responseSent || res.headersSent) {
      console.warn('[SUBSCRIPTION STATUS] Attempted to send response but already sent');
      return;
    }
    responseSent = true;
    
    // Ensure CORS headers
    const origin = req.headers.origin;
    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
    }
    
    res.status(statusCode).json(data);
  };
  
  console.log('[SUBSCRIPTION ROUTER] GET /status route hit');
  console.log('[SUBSCRIPTION ROUTER] Request origin:', req.headers.origin);
  console.log('[SUBSCRIPTION ROUTER] Request method:', req.method);
  
  try {
    const auth0Id = req.auth0Id || req.headers['x-auth0-id'];
    
    // Log for debugging
    console.log(`[SUBSCRIPTION STATUS] Checking status for auth0Id: ${auth0Id}`);
    console.log(`[SUBSCRIPTION STATUS] Request headers x-auth0-id: ${req.headers['x-auth0-id']}`);
    console.log(`[SUBSCRIPTION STATUS] FREE_ACCESS_IDS:`, FREE_ACCESS_IDS);
    console.log(`[SUBSCRIPTION STATUS] RAZORPAY_KEY_ID set:`, !!process.env.RAZORPAY_KEY_ID);
    console.log(`[SUBSCRIPTION STATUS] RAZORPAY_KEY_ID value:`, process.env.RAZORPAY_KEY_ID?.substring(0, 10) + '...');
    console.log(`[SUBSCRIPTION STATUS] NODE_ENV:`, process.env.NODE_ENV);
    
    if (!auth0Id) {
      // Check if free access is disabled for testing
      const disableFreeAccess = process.env.DISABLE_FREE_ACCESS_FOR_TESTING === 'true';
      if (disableFreeAccess) {
        console.log(`[SUBSCRIPTION STATUS] No auth0Id but free access disabled for testing - returning no access`);
        return sendResponse(200, {
          ok: true,
          hasAccess: false,
          status: 'none',
          isTrial: false,
          isActive: false,
          trialEndDate: null,
          subscriptionEndDate: null,
          nextBillingDate: null,
          razorpaySubscriptionId: null,
        });
      }
      
      // Even if no auth0Id, allow access on localhost (only if free access is not disabled)
      const hasRazorpayKeys = process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET;
      const isTestKey = process.env.RAZORPAY_KEY_ID?.includes('test') || 
                        process.env.RAZORPAY_KEY_ID?.includes('rzp_test');
      const isDevelopment = process.env.NODE_ENV !== 'production';
      const isLocalhost = !hasRazorpayKeys || isTestKey || isDevelopment;
      
      console.log(`[SUBSCRIPTION STATUS] No auth0Id - HasKeys: ${hasRazorpayKeys}, IsTestKey: ${isTestKey}, IsDev: ${isDevelopment}, IsLocalhost: ${isLocalhost}`);
      
      if (isLocalhost) {
        console.log(`[SUBSCRIPTION STATUS] No auth0Id but localhost detected - allowing free access`);
        return sendResponse(200, {
          ok: true,
          hasAccess: true,
          status: 'free',
          isTrial: false,
          isActive: true,
          trialEndDate: null,
          subscriptionEndDate: null,
          nextBillingDate: null,
          razorpaySubscriptionId: null,
          isFreeAccess: true,
        });
      }
      return sendResponse(401, { ok: false, error: 'Unauthorized' });
    }
    
    // Check free access first (before any database operations)
    const freeAccessResult = await hasFreeAccess(auth0Id);
    console.log(`[SUBSCRIPTION STATUS] DISABLE_FREE_ACCESS_FOR_TESTING: ${process.env.DISABLE_FREE_ACCESS_FOR_TESTING}`);
    console.log(`[SUBSCRIPTION STATUS] hasFreeAccess(${auth0Id}) = ${freeAccessResult}`);
    
    if (freeAccessResult) {
      console.log(`[SUBSCRIPTION STATUS] User ${auth0Id} has free access - skipping subscription check`);
      return sendResponse(200, {
        ok: true,
        hasAccess: true,
        status: 'free',
        isTrial: false,
        isActive: true,
        trialEndDate: null,
        subscriptionEndDate: null,
        nextBillingDate: null,
        razorpaySubscriptionId: null,
        isFreeAccess: true,
      });
    }
    
    // Get user
    let user;
    try {
      user = await User.findOne({ auth0Id });
      if (!user) {
        console.warn(`[SUBSCRIPTION STATUS] User not found for auth0Id: ${auth0Id}`);
        return sendResponse(404, { ok: false, error: 'User not found' });
      }
    } catch (dbError) {
      console.error('[SUBSCRIPTION STATUS] Database error finding user:', dbError);
      return sendResponse(500, { 
        ok: false, 
        error: 'Database error while finding user',
        details: dbError.message 
      });
    }
    
    // Only create trial if free access is NOT disabled (for testing Paywall)
    // When testing Paywall, we don't want to auto-create trials
    if (!FORCE_DISABLE_FREE_ACCESS && process.env.DISABLE_FREE_ACCESS_FOR_TESTING !== 'true') {
      try {
        // Ensure subscription exists (creates trial if new user)
        await getOrCreateSubscription(auth0Id, user._id);
      } catch (subError) {
        console.error('[SUBSCRIPTION STATUS] Error creating/getting subscription:', subError);
        // Continue anyway - we'll still try to get status
      }
    }
    
    // Get current status
    let status;
    try {
      status = await checkSubscriptionStatus(auth0Id);
      console.log(`[SUBSCRIPTION STATUS] Final status for ${auth0Id}:`, status);
    } catch (statusError) {
      console.error('[SUBSCRIPTION STATUS] Error checking subscription status:', statusError);
      return sendResponse(500, {
        ok: false,
        error: 'Failed to check subscription status',
        details: statusError.message,
      });
    }
    
    return sendResponse(200, {
      ok: true,
      ...status,
    });
  } catch (error) {
    console.error('[SUBSCRIPTION STATUS] Unexpected error:', error);
    console.error('[SUBSCRIPTION STATUS] Error stack:', error.stack);
    return sendResponse(500, {
      ok: false,
      error: error.message || 'Failed to get subscription status',
    });
  }
});

/**
 * POST /api/subscription/sync-status
 * Manually sync subscription status from Razorpay
 * Useful when payment is successful but status wasn't updated
 */
router.post('/sync-status', async (req, res) => {
  try {
    const auth0Id = req.auth0Id;
    if (!auth0Id) {
      return res.status(401).json({ ok: false, error: 'Unauthorized' });
    }
    
    const subscription = await Subscription.findOne({ auth0Id });
    
    if (!subscription || !subscription.razorpaySubscriptionId) {
      return res.status(404).json({
        ok: false,
        error: 'No subscription found to sync',
      });
    }
    
    console.log(`[SYNC STATUS] Syncing subscription ${subscription.razorpaySubscriptionId} from Razorpay`);
    
    // Fetch subscription details from Razorpay
    const razorpaySubscription = await razorpay.subscriptions.fetch(subscription.razorpaySubscriptionId);
    console.log(`[SYNC STATUS] Razorpay subscription status: ${razorpaySubscription.status}`);
    
    // Check if subscription is active in Razorpay
    if (razorpaySubscription.status === 'active' || razorpaySubscription.status === 'authenticated') {
      // Check if there's a payment
      if (razorpaySubscription.notes && razorpaySubscription.notes.auth0Id === auth0Id) {
        // Update subscription status
        subscription.status = 'active';
        
        // Set dates if not already set
        if (!subscription.subscriptionStartDate) {
          subscription.subscriptionStartDate = new Date(razorpaySubscription.created_at * 1000);
        }
        
        // Calculate next billing date
        const startTime = razorpaySubscription.current_start 
          ? new Date(razorpaySubscription.current_start * 1000)
          : new Date(razorpaySubscription.created_at * 1000);
        const nextBilling = new Date(startTime);
        nextBilling.setMonth(nextBilling.getMonth() + 1);
        subscription.nextBillingDate = nextBilling;
        subscription.subscriptionEndDate = nextBilling;
        
        await subscription.save();
        console.log(`[SYNC STATUS] Subscription ${subscription._id} synced to 'active'`);
        
        return res.json({
          ok: true,
          message: 'Subscription status synced successfully',
          status: 'active',
        });
      }
    }
    
    // If subscription is still in created/pending state, check for payments
    if (razorpaySubscription.status === 'created' || razorpaySubscription.status === 'pending') {
      // Try to find payments for this subscription
      try {
        const payments = await razorpay.payments.all({
          'subscription_id': subscription.razorpaySubscriptionId,
        });
        
        if (payments.items && payments.items.length > 0) {
          const successfulPayment = payments.items.find(p => p.status === 'captured' || p.status === 'authorized');
          
          if (successfulPayment) {
            console.log(`[SYNC STATUS] Found successful payment ${successfulPayment.id}, activating subscription`);
            
            subscription.status = 'active';
            subscription.subscriptionStartDate = new Date(successfulPayment.created_at * 1000);
            
            const nextBilling = new Date(successfulPayment.created_at * 1000);
            nextBilling.setMonth(nextBilling.getMonth() + 1);
            subscription.nextBillingDate = nextBilling;
            subscription.subscriptionEndDate = nextBilling;
            
            await subscription.save();
            
            // Also record the payment
            const { Payment } = await import('../models/Payment.js');
            await Payment.findOneAndUpdate(
              { razorpayPaymentId: successfulPayment.id },
              {
                userId: subscription.userId,
                auth0Id: subscription.auth0Id,
                subscriptionId: subscription._id,
                razorpayPaymentId: successfulPayment.id,
                razorpaySubscriptionId: subscription.razorpaySubscriptionId,
                amount: successfulPayment.amount,
                amountInRupees: successfulPayment.amount / 100,
                currency: successfulPayment.currency,
                status: successfulPayment.status === 'captured' ? 'captured' : 'authorized',
                method: successfulPayment.method,
                paidAt: successfulPayment.captured_at ? new Date(successfulPayment.captured_at * 1000) : new Date(),
              },
              { upsert: true, new: true }
            );
            
            return res.json({
              ok: true,
              message: 'Subscription activated from payment history',
              status: 'active',
            });
          }
        }
      } catch (error) {
        console.error('[SYNC STATUS] Error fetching payments:', error);
      }
    }
    
    return res.json({
      ok: true,
      message: 'Subscription status checked',
      razorpayStatus: razorpaySubscription.status,
      currentStatus: subscription.status,
    });
  } catch (error) {
    console.error('Failed to sync subscription status:', error);
    res.status(500).json({
      ok: false,
      error: error.message || 'Failed to sync subscription status',
    });
  }
});

/**
 * POST /api/subscription/cancel
 * Cancels the active subscription
 */
router.post('/cancel', async (req, res) => {
  try {
    const auth0Id = req.auth0Id;
    if (!auth0Id) {
      return res.status(401).json({ ok: false, error: 'Unauthorized' });
    }
    
    const subscription = await Subscription.findOne({ auth0Id });
    
    if (!subscription || !subscription.razorpaySubscriptionId) {
      return res.status(404).json({
        ok: false,
        error: 'No active subscription found',
      });
    }
    
    // Cancel subscription in Razorpay
    try {
      await razorpay.subscriptions.cancel(subscription.razorpaySubscriptionId);
    } catch (error) {
      // If already cancelled, continue
      if (error.statusCode !== 400) {
        throw error;
      }
    }
    
    // Update subscription status
    subscription.status = 'cancelled';
    subscription.cancelledAt = new Date();
    subscription.cancelReason = req.body.reason || 'User requested cancellation';
    await subscription.save();
    
    res.json({
      ok: true,
      message: 'Subscription cancelled successfully',
    });
  } catch (error) {
    console.error('Failed to cancel subscription:', error);
    res.status(500).json({
      ok: false,
      error: error.message || 'Failed to cancel subscription',
    });
  }
});

// Catch-all route for debugging (must be last)
// Catch-all error handler for this router
router.use((err, req, res, next) => {
  console.error('[SUBSCRIPTION ROUTER] Unhandled error:', err);
  console.error('[SUBSCRIPTION ROUTER] Error stack:', err.stack);
  
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

router.use('*', (req, res) => {
  console.log(`[SUBSCRIPTION ROUTER] Unmatched route: ${req.method} ${req.originalUrl}`);
  
  // Ensure CORS headers on 404
  const origin = req.headers.origin;
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  }
  
  res.status(404).json({ 
    ok: false, 
    error: 'Route not found in subscription router',
    method: req.method,
    path: req.path,
    originalUrl: req.originalUrl
  });
});

export default router;

