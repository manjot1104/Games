import mongoose, { Schema } from 'mongoose';

/**
 * Payment Schema
 * Tracks all payment transactions (successful and failed)
 */
const PaymentSchema = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: false, // Allow null for payments that can't be linked immediately (webhook edge cases)
      index: true,
    },
    auth0Id: {
      type: String,
      required: false, // Allow null for payments that can't be linked immediately (webhook edge cases)
      index: true,
    },
    subscriptionId: {
      type: Schema.Types.ObjectId,
      ref: 'Subscription',
      default: null,
    },
    
    // Razorpay payment details
    razorpayPaymentId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    razorpayOrderId: {
      type: String,
      default: null,
    },
    razorpaySubscriptionId: {
      type: String,
      default: null,
      index: true,
    },
    
    // Payment details
    amount: {
      type: Number,
      required: true, // Amount in paise (smallest currency unit)
    },
    currency: {
      type: String,
      default: 'INR',
    },
    amountInRupees: {
      type: Number,
      required: true, // Amount in rupees for easier reading
    },
    
    // Payment status
    status: {
      type: String,
      enum: ['created', 'authorized', 'captured', 'refunded', 'failed'],
      required: true,
    },
    
    // Payment method
    method: {
      type: String,
      default: null, // 'card', 'upi', 'netbanking', 'wallet', etc.
    },
    
    // Failure details
    failureReason: {
      type: String,
      default: null,
    },
    failureCode: {
      type: String,
      default: null,
    },
    
    // Timestamps
    paidAt: {
      type: Date,
      default: null,
    },
    refundedAt: {
      type: Date,
      default: null,
    },
    
    // Webhook tracking
    webhookReceived: {
      type: Boolean,
      default: false,
    },
    webhookProcessedAt: {
      type: Date,
      default: null,
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

// Indexes for efficient queries
PaymentSchema.index({ userId: 1, createdAt: -1 });
PaymentSchema.index({ auth0Id: 1, createdAt: -1 });
PaymentSchema.index({ razorpayPaymentId: 1 });
PaymentSchema.index({ status: 1, createdAt: -1 });

export const Payment = mongoose.models.Payment || mongoose.model('Payment', PaymentSchema);


