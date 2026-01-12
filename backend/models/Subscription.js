import mongoose, { Schema } from 'mongoose';

/**
 * Subscription Schema
 * Tracks user subscription status, trial period, and Razorpay subscription details
 */
const SubscriptionSchema = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    auth0Id: {
      type: String,
      required: true,
      index: true,
    },
    
    // Trial period tracking
    trialStartDate: {
      type: Date,
      default: null,
    },
    trialEndDate: {
      type: Date,
      default: null,
    },
    trialUsed: {
      type: Boolean,
      default: false,
    },
    
    // Razorpay subscription details
    razorpaySubscriptionId: {
      type: String,
      default: null,
      index: true,
    },
    razorpayPlanId: {
      type: String,
      default: null,
    },
    razorpayCustomerId: {
      type: String,
      default: null,
    },
    
    // Subscription status
    status: {
      type: String,
      enum: ['trial', 'created', 'active', 'expired', 'cancelled', 'past_due'],
      default: 'trial',
    },
    
    // Subscription dates
    subscriptionStartDate: {
      type: Date,
      default: null,
    },
    subscriptionEndDate: {
      type: Date,
      default: null,
    },
    nextBillingDate: {
      type: Date,
      default: null,
    },
    
    // Cancellation tracking
    cancelledAt: {
      type: Date,
      default: null,
    },
    cancelReason: {
      type: String,
      default: null,
    },
    
    // Payment method details (stored for reference, not sensitive data)
    paymentMethod: {
      type: String,
      default: null, // e.g., 'card', 'upi', 'netbanking'
    },
    
    // Metadata
    metadata: {
      type: Map,
      of: Schema.Types.Mixed,
      default: {},
    },
  },
  {
    timestamps: true,
  }
);

// Index for efficient queries
SubscriptionSchema.index({ userId: 1, status: 1 });
SubscriptionSchema.index({ auth0Id: 1, status: 1 });
SubscriptionSchema.index({ razorpaySubscriptionId: 1 });

/**
 * Check if subscription is currently active (trial or paid)
 */
SubscriptionSchema.methods.isActive = function () {
  const now = new Date();
  
  // Check if in trial period
  if (this.status === 'trial' && this.trialEndDate && this.trialEndDate > now) {
    return true;
  }
  
  // Check if paid subscription is active
  if (this.status === 'active' && this.subscriptionEndDate && this.subscriptionEndDate > now) {
    return true;
  }
  
  return false;
};

/**
 * Check if trial period is active
 */
SubscriptionSchema.methods.isTrialActive = function () {
  if (!this.trialStartDate || !this.trialEndDate) return false;
  const now = new Date();
  return this.status === 'trial' && this.trialEndDate > now;
};

/**
 * Check if trial has expired
 */
SubscriptionSchema.methods.isTrialExpired = function () {
  if (!this.trialEndDate) return false;
  const now = new Date();
  return this.trialEndDate <= now && this.status === 'trial';
};

export const Subscription = mongoose.models.Subscription || mongoose.model('Subscription', SubscriptionSchema);


