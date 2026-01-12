import { Buffer } from 'buffer';
import crypto from 'crypto';
import express from 'express';
import Razorpay from 'razorpay';
import { Payment } from '../models/Payment.js';
import { Subscription } from '../models/Subscription.js';

const router = express.Router();

// Initialize Razorpay for webhook verification
// Keys should be in environment variables: RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET
// If keys are not set, create a dummy instance for localhost development
let razorpay;
const hasRazorpayKeys = process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET;

if (hasRazorpayKeys) {
  try {
    razorpay = new Razorpay({
      key_id: process.env.RAZORPAY_KEY_ID,
      key_secret: process.env.RAZORPAY_KEY_SECRET,
    });
    console.log('[RAZORPAY WEBHOOK] Razorpay initialized');
  } catch (error) {
    console.error('[RAZORPAY WEBHOOK] Failed to initialize Razorpay:', error);
    // Create a dummy instance to prevent module load failure
    razorpay = { plans: {}, customers: {}, subscriptions: {}, payments: {} };
  }
} else {
  console.log('[RAZORPAY WEBHOOK] Razorpay keys not configured - using dummy instance for localhost development');
  // Create a dummy instance to prevent module load failure
  razorpay = { plans: {}, customers: {}, subscriptions: {}, payments: {} };
}

/**
 * Middleware: Verify Razorpay webhook signature
 */
function verifyWebhookSignature(req, res, next) {
  const signature = req.headers['x-razorpay-signature'];
  const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
  
  // In development without webhook secret, allow webhook (for testing)
  // In production, webhook secret must be configured
  const isDevelopment = process.env.NODE_ENV !== 'production';
  const hasRazorpayKeys = process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET;
  
  if (!webhookSecret) {
    if (isDevelopment || !hasRazorpayKeys) {
      console.warn('[WEBHOOK] Webhook secret not configured - skipping verification (development mode)');
      // In development, still try to parse body if needed
      if (typeof req.body === 'string' || req.body instanceof Buffer) {
        try {
          req.body = JSON.parse(req.body.toString('utf8'));
        } catch (error) {
          console.error('[WEBHOOK] Error parsing webhook body:', error);
          return res.status(400).json({ error: 'Invalid JSON' });
        }
      }
      return next();
    } else {
      console.error('[WEBHOOK] Webhook secret missing in production!');
      return res.status(401).json({ error: 'Webhook secret not configured' });
    }
  }
  
  if (!signature) {
    console.warn('[WEBHOOK] Webhook signature missing in headers');
    return res.status(401).json({ error: 'Missing signature' });
  }
  
  // Get raw body (should be Buffer if raw parser is used, otherwise stringify parsed body)
  let rawBody;
  if (req.body instanceof Buffer) {
    rawBody = req.body.toString('utf8');
  } else if (typeof req.body === 'string') {
    rawBody = req.body;
  } else {
    // If body is already parsed, stringify it (this might not match Razorpay's raw body)
    // Better to use raw body parser middleware
    rawBody = JSON.stringify(req.body);
    console.warn('[WEBHOOK] Body already parsed - signature verification may fail. Consider using raw body parser.');
  }
  
  // Verify signature using raw body
  const generatedSignature = crypto
    .createHmac('sha256', webhookSecret)
    .update(rawBody)
    .digest('hex');
  
  if (generatedSignature !== signature) {
    console.warn('[WEBHOOK] Invalid webhook signature');
    console.warn('[WEBHOOK] Expected:', signature);
    console.warn('[WEBHOOK] Generated:', generatedSignature);
    console.warn('[WEBHOOK] Body length:', rawBody.length);
    return res.status(401).json({ error: 'Invalid signature' });
  }
  
  // Parse body if it's still a string or Buffer
  if (typeof req.body === 'string' || req.body instanceof Buffer) {
    try {
      req.body = JSON.parse(rawBody);
    } catch (error) {
      console.error('[WEBHOOK] Error parsing webhook body:', error);
      return res.status(400).json({ error: 'Invalid JSON' });
    }
  }
  
  next();
}

router.post('/razorpay', verifyWebhookSignature, async (req, res) => {
  try {
    const event = req.body.event;
    const payload = req.body.payload;
    
    if (!event) {
      console.warn('[WEBHOOK] Webhook received without event type');
      return res.status(200).json({ received: true, warning: 'No event type' });
    }
    
    if (!payload) {
      console.warn(`[WEBHOOK] Webhook event ${event} received without payload`);
      return res.status(200).json({ received: true, warning: 'No payload' });
    }
    
    console.log(`[WEBHOOK] Received Razorpay webhook: ${event}`);
    
    // Handle different event types
    switch (event) {
      case 'payment.captured':
        if (payload.payment?.entity) {
          await handlePaymentCaptured(payload.payment.entity);
        } else {
          console.warn('[WEBHOOK] payment.captured event missing payment.entity');
        }
        break;
        
      case 'payment.failed':
        if (payload.payment?.entity) {
          await handlePaymentFailed(payload.payment.entity);
        } else {
          console.warn('[WEBHOOK] payment.failed event missing payment.entity');
        }
        break;
        
      case 'subscription.activated':
        if (payload.subscription?.entity) {
          await handleSubscriptionActivated(payload.subscription.entity);
        } else {
          console.warn('[WEBHOOK] subscription.activated event missing subscription.entity');
        }
        break;
        
      case 'subscription.cancelled':
        if (payload.subscription?.entity) {
          await handleSubscriptionCancelled(payload.subscription.entity);
        } else {
          console.warn('[WEBHOOK] subscription.cancelled event missing subscription.entity');
        }
        break;
        
      case 'subscription.charged':
        if (payload.subscription?.entity) {
          await handleSubscriptionCharged(payload.subscription.entity);
        } else {
          console.warn('[WEBHOOK] subscription.charged event missing subscription.entity');
        }
        break;
        
      case 'subscription.paused':
        if (payload.subscription?.entity) {
          await handleSubscriptionPaused(payload.subscription.entity);
        } else {
          console.warn('[WEBHOOK] subscription.paused event missing subscription.entity');
        }
        break;
        
      case 'subscription.resumed':
        if (payload.subscription?.entity) {
          await handleSubscriptionResumed(payload.subscription.entity);
        } else {
          console.warn('[WEBHOOK] subscription.resumed event missing subscription.entity');
        }
        break;
        
      default:
        console.log(`[WEBHOOK] Unhandled webhook event: ${event}`);
    }
    
    // Always return 200 to acknowledge receipt (prevents Razorpay retries)
    res.status(200).json({ received: true, event });
  } catch (error) {
    console.error('[WEBHOOK] Webhook processing error:', error);
    // Still return 200 to prevent Razorpay from retrying
    // Log error for manual investigation
    res.status(200).json({ 
      received: true, 
      error: error.message,
      note: 'Webhook received but processing failed. Check server logs.'
    });
  }
});

/**
 * Handle payment.captured event
 */
async function handlePaymentCaptured(paymentEntity) {
  try {
    const paymentId = paymentEntity.id;
    const subscriptionId = paymentEntity.subscription_id;
    
    if (!paymentId) {
      console.error('[WEBHOOK] Payment ID missing in payment.captured event');
      return;
    }
    
    // Find subscription first (we need it for user info and to update it)
    let subscription = null;
    if (subscriptionId) {
      subscription = await Subscription.findOne({
        razorpaySubscriptionId: subscriptionId,
      });
      
      if (!subscription) {
        console.warn(`[WEBHOOK] Subscription not found for Razorpay ID: ${subscriptionId}. Payment ID: ${paymentId}`);
        // Still try to record payment if possible (without subscription link)
      }
    }
    
    // Find or create payment record
    let payment = await Payment.findOne({ razorpayPaymentId: paymentId });
    
    if (!payment) {
      // Create new payment record
      // If subscription exists, use its user info. Otherwise, payment will need manual linking
      if (subscription && subscription.userId) {
        try {
          payment = await Payment.create({
            userId: subscription.userId,
            auth0Id: subscription.auth0Id,
            subscriptionId: subscription._id,
            razorpayPaymentId: paymentId,
            razorpayOrderId: paymentEntity.order_id || null,
            razorpaySubscriptionId: subscriptionId || null,
            amount: paymentEntity.amount || 0,
            amountInRupees: (paymentEntity.amount || 0) / 100,
            currency: paymentEntity.currency || 'INR',
            status: 'captured',
            method: paymentEntity.method || null,
            paidAt: paymentEntity.captured_at ? new Date(paymentEntity.captured_at * 1000) : new Date(),
            webhookReceived: true,
            webhookProcessedAt: new Date(),
          });
          console.log(`[WEBHOOK] Created payment record: ${paymentId}`);
        } catch (error) {
          console.error(`[WEBHOOK] Failed to create payment record: ${paymentId}`, error);
          // Continue to try updating subscription even if payment record creation fails
        }
      } else {
        console.warn(`[WEBHOOK] Cannot create payment record for ${paymentId}: Subscription not found or missing user info`);
        // Payment will need to be manually linked later
      }
    } else {
      // Update existing payment
      try {
        payment.status = 'captured';
        payment.paidAt = paymentEntity.captured_at ? new Date(paymentEntity.captured_at * 1000) : new Date();
        payment.webhookReceived = true;
        payment.webhookProcessedAt = new Date();
        
        // Update subscription link if missing and we found subscription
        if (subscription && !payment.subscriptionId) {
          payment.subscriptionId = subscription._id;
          payment.userId = subscription.userId;
          payment.auth0Id = subscription.auth0Id;
        }
        
        await payment.save();
        console.log(`[WEBHOOK] Updated payment record: ${paymentId}`);
      } catch (error) {
        console.error(`[WEBHOOK] Failed to update payment record: ${paymentId}`, error);
      }
    }
    
    // Update subscription status (only if subscription was found)
    if (subscription) {
      try {
        subscription.status = 'active';
        subscription.subscriptionStartDate = paymentEntity.created_at 
          ? new Date(paymentEntity.created_at * 1000) 
          : new Date();
        
        // Calculate next billing date (1 month from payment capture)
        const captureTime = paymentEntity.captured_at ? new Date(paymentEntity.captured_at * 1000) : new Date();
        const nextBilling = new Date(captureTime);
        nextBilling.setMonth(nextBilling.getMonth() + 1);
        subscription.nextBillingDate = nextBilling;
        subscription.subscriptionEndDate = nextBilling;
        
        await subscription.save();
        console.log(`[WEBHOOK] Payment captured: ${paymentId}, Subscription activated: ${subscriptionId}`);
      } catch (error) {
        console.error(`[WEBHOOK] Failed to update subscription: ${subscriptionId}`, error);
        // Don't throw - webhook should still return 200
      }
    } else if (subscriptionId) {
      console.warn(`[WEBHOOK] Could not update subscription: ${subscriptionId} - not found in database`);
    }
  } catch (error) {
    console.error('[WEBHOOK] Error handling payment.captured:', error);
    // Don't throw - webhook should return 200 to prevent retries
    // But log the error for manual investigation
  }
}

/**
 * Handle payment.failed event
 */
async function handlePaymentFailed(paymentEntity) {
  try {
    const paymentId = paymentEntity.id;
    const subscriptionId = paymentEntity.subscription_id;
    
    if (!paymentId) {
      console.error('[WEBHOOK] Payment ID missing in payment.failed event');
      return;
    }
    
    // Find subscription first
    let subscription = null;
    if (subscriptionId) {
      subscription = await Subscription.findOne({
        razorpaySubscriptionId: subscriptionId,
      });
      
      if (!subscription) {
        console.warn(`[WEBHOOK] Subscription not found for failed payment. Razorpay ID: ${subscriptionId}. Payment ID: ${paymentId}`);
      }
    }
    
    // Record failed payment
    let payment = await Payment.findOne({ razorpayPaymentId: paymentId });
    
    if (!payment) {
      // Create new failed payment record if subscription exists
      if (subscription && subscription.userId) {
        try {
          payment = await Payment.create({
            userId: subscription.userId,
            auth0Id: subscription.auth0Id,
            subscriptionId: subscription._id,
            razorpayPaymentId: paymentId,
            razorpayOrderId: paymentEntity.order_id || null,
            razorpaySubscriptionId: subscriptionId || null,
            amount: paymentEntity.amount || 0,
            amountInRupees: (paymentEntity.amount || 0) / 100,
            currency: paymentEntity.currency || 'INR',
            status: 'failed',
            method: paymentEntity.method || null,
            failureReason: paymentEntity.error?.description || paymentEntity.error_description || 'Payment failed',
            failureCode: paymentEntity.error?.code || paymentEntity.error_code || null,
            webhookReceived: true,
            webhookProcessedAt: new Date(),
          });
          console.log(`[WEBHOOK] Created failed payment record: ${paymentId}`);
        } catch (error) {
          console.error(`[WEBHOOK] Failed to create failed payment record: ${paymentId}`, error);
        }
      } else {
        console.warn(`[WEBHOOK] Cannot create failed payment record for ${paymentId}: Subscription not found or missing user info`);
      }
    } else {
      // Update existing payment
      try {
        payment.status = 'failed';
        payment.failureReason = paymentEntity.error?.description || paymentEntity.error_description || 'Payment failed';
        payment.failureCode = paymentEntity.error?.code || paymentEntity.error_code || null;
        payment.webhookReceived = true;
        payment.webhookProcessedAt = new Date();
        
        // Update subscription link if missing and we found subscription
        if (subscription && !payment.subscriptionId) {
          payment.subscriptionId = subscription._id;
          payment.userId = subscription.userId;
          payment.auth0Id = subscription.auth0Id;
        }
        
        await payment.save();
        console.log(`[WEBHOOK] Updated failed payment record: ${paymentId}`);
      } catch (error) {
        console.error(`[WEBHOOK] Failed to update failed payment record: ${paymentId}`, error);
      }
    }
    
    // Update subscription status to past_due (only if subscription was found)
    if (subscription) {
      try {
        subscription.status = 'past_due';
        await subscription.save();
        console.log(`[WEBHOOK] Payment failed: ${paymentId}, Subscription marked as past_due: ${subscriptionId}`);
      } catch (error) {
        console.error(`[WEBHOOK] Failed to update subscription status for failed payment: ${subscriptionId}`, error);
      }
    }
  } catch (error) {
    console.error('[WEBHOOK] Error handling payment.failed:', error);
    // Don't throw - webhook should return 200 to prevent retries
  }
}

/**
 * Handle subscription.activated event
 */
async function handleSubscriptionActivated(subscriptionEntity) {
  try {
    const subscriptionId = subscriptionEntity.id;
    if (!subscriptionId) {
      console.error('[WEBHOOK] Subscription ID missing in subscription.activated event');
      return;
    }

    const subscription = await Subscription.findOne({
      razorpaySubscriptionId: subscriptionId,
    });
    
    if (!subscription) {
      console.warn(`[WEBHOOK] Subscription not found for activated event. Razorpay ID: ${subscriptionId}`);
      return;
    }
    
    try {
      subscription.status = 'active';
      subscription.subscriptionStartDate = subscriptionEntity.created_at 
        ? new Date(subscriptionEntity.created_at * 1000) 
        : new Date();
      
      // Calculate next billing date (1 month from current_start or created_at)
      const startTime = subscriptionEntity.current_start 
        ? new Date(subscriptionEntity.current_start * 1000)
        : subscriptionEntity.created_at 
          ? new Date(subscriptionEntity.created_at * 1000)
          : new Date();
      const nextBilling = new Date(startTime);
      nextBilling.setMonth(nextBilling.getMonth() + 1);
      subscription.nextBillingDate = nextBilling;
      subscription.subscriptionEndDate = nextBilling;
      
      await subscription.save();
      console.log(`[WEBHOOK] Subscription activated: ${subscriptionId}`);
    } catch (error) {
      console.error(`[WEBHOOK] Failed to update subscription on activation: ${subscriptionId}`, error);
    }
  } catch (error) {
    console.error('[WEBHOOK] Error handling subscription.activated:', error);
    // Don't throw - webhook should return 200
  }
}

/**
 * Handle subscription.cancelled event
 */
async function handleSubscriptionCancelled(subscriptionEntity) {
  try {
    const subscriptionId = subscriptionEntity.id;
    if (!subscriptionId) {
      console.error('[WEBHOOK] Subscription ID missing in subscription.cancelled event');
      return;
    }

    const subscription = await Subscription.findOne({
      razorpaySubscriptionId: subscriptionId,
    });
    
    if (!subscription) {
      console.warn(`[WEBHOOK] Subscription not found for cancelled event. Razorpay ID: ${subscriptionId}`);
      return;
    }
    
    try {
      subscription.status = 'cancelled';
      subscription.cancelledAt = subscriptionEntity.cancelled_at 
        ? new Date(subscriptionEntity.cancelled_at * 1000) 
        : new Date();
      subscription.cancelReason = subscriptionEntity.cancel_reason || 'Cancelled via Razorpay webhook';
      await subscription.save();
      console.log(`[WEBHOOK] Subscription cancelled: ${subscriptionId}`);
    } catch (error) {
      console.error(`[WEBHOOK] Failed to update subscription on cancellation: ${subscriptionId}`, error);
    }
  } catch (error) {
    console.error('[WEBHOOK] Error handling subscription.cancelled:', error);
    // Don't throw - webhook should return 200
  }
}

/**
 * Handle subscription.charged event (recurring payment)
 */
async function handleSubscriptionCharged(subscriptionEntity) {
  try {
    const subscriptionId = subscriptionEntity.id;
    if (!subscriptionId) {
      console.error('[WEBHOOK] Subscription ID missing in subscription.charged event');
      return;
    }

    const subscription = await Subscription.findOne({
      razorpaySubscriptionId: subscriptionId,
    });
    
    if (!subscription) {
      console.warn(`[WEBHOOK] Subscription not found for charged event. Razorpay ID: ${subscriptionId}`);
      return;
    }
    
    try {
      // Update subscription end date (extend by 1 month from current end or now)
      const currentEnd = subscription.subscriptionEndDate || new Date();
      const newEndDate = new Date(currentEnd);
      newEndDate.setMonth(newEndDate.getMonth() + 1);
      subscription.subscriptionEndDate = newEndDate;
      
      // Update next billing date (1 month from now, or from charge time if available)
      const chargeTime = subscriptionEntity.charged_at 
        ? new Date(subscriptionEntity.charged_at * 1000)
        : new Date();
      const nextBilling = new Date(chargeTime);
      nextBilling.setMonth(nextBilling.getMonth() + 1);
      subscription.nextBillingDate = nextBilling;
      
      subscription.status = 'active';
      await subscription.save();
      console.log(`[WEBHOOK] Subscription charged (renewed): ${subscriptionId}, Next billing: ${nextBilling}`);
    } catch (error) {
      console.error(`[WEBHOOK] Failed to update subscription on charge: ${subscriptionId}`, error);
    }
  } catch (error) {
    console.error('[WEBHOOK] Error handling subscription.charged:', error);
    // Don't throw - webhook should return 200
  }
}

/**
 * Handle subscription.paused event
 */
async function handleSubscriptionPaused(subscriptionEntity) {
  try {
    const subscriptionId = subscriptionEntity.id;
    if (!subscriptionId) {
      console.error('[WEBHOOK] Subscription ID missing in subscription.paused event');
      return;
    }

    const subscription = await Subscription.findOne({
      razorpaySubscriptionId: subscriptionId,
    });
    
    if (!subscription) {
      console.warn(`[WEBHOOK] Subscription not found for paused event. Razorpay ID: ${subscriptionId}`);
      return;
    }
    
    try {
      subscription.status = 'cancelled'; // Treat paused as cancelled for access
      await subscription.save();
      console.log(`[WEBHOOK] Subscription paused: ${subscriptionId}`);
    } catch (error) {
      console.error(`[WEBHOOK] Failed to update subscription on pause: ${subscriptionId}`, error);
    }
  } catch (error) {
    console.error('[WEBHOOK] Error handling subscription.paused:', error);
    // Don't throw - webhook should return 200
  }
}

/**
 * Handle subscription.resumed event
 */
async function handleSubscriptionResumed(subscriptionEntity) {
  try {
    const subscriptionId = subscriptionEntity.id;
    if (!subscriptionId) {
      console.error('[WEBHOOK] Subscription ID missing in subscription.resumed event');
      return;
    }

    const subscription = await Subscription.findOne({
      razorpaySubscriptionId: subscriptionId,
    });
    
    if (!subscription) {
      console.warn(`[WEBHOOK] Subscription not found for resumed event. Razorpay ID: ${subscriptionId}`);
      return;
    }
    
    try {
      subscription.status = 'active';
      // Recalculate end date if needed
      if (!subscription.subscriptionEndDate || subscription.subscriptionEndDate < new Date()) {
        const nextBilling = new Date();
        nextBilling.setMonth(nextBilling.getMonth() + 1);
        subscription.subscriptionEndDate = nextBilling;
        subscription.nextBillingDate = nextBilling;
      }
      await subscription.save();
      console.log(`[WEBHOOK] Subscription resumed: ${subscriptionId}`);
    } catch (error) {
      console.error(`[WEBHOOK] Failed to update subscription on resume: ${subscriptionId}`, error);
    }
  } catch (error) {
    console.error('[WEBHOOK] Error handling subscription.resumed:', error);
    // Don't throw - webhook should return 200
  }
}

export default router;

