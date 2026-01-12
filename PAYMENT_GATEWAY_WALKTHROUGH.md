# Payment Gateway Walkthrough - Complete Guide

## 📋 Overview

Your application uses **Razorpay** as the payment gateway to manage subscriptions for the **Therapy Progress** section. The system includes:
- **7-day free trial** for new users
- **Monthly subscription** (₹299/month) after trial
- **Automatic recurring payments**
- **Webhook-based payment tracking**
- **Access control** based on subscription status

---

## 🗂️ File Structure

### **Frontend Files**

1. **`app/(tabs)/TherapyProgress.tsx`**
   - Main screen that shows therapy progress
   - **Access Guard**: Checks subscription status before allowing access
   - Shows `Paywall` component if user doesn't have access
   - Location: `app/(tabs)/TherapyProgress.tsx`

2. **`components/Paywall.tsx`**
   - UI component for subscription management
   - Shows trial status, subscription plans, and payment options
   - Handles Razorpay checkout (web only)
   - Location: `components/Paywall.tsx`

3. **`utils/api.ts`**
   - API functions for subscription management:
     - `getSubscriptionStatus()` - Check current subscription status
     - `createSubscription()` - Create new subscription
     - `verifyPayment()` - Verify payment after checkout
     - `cancelSubscription()` - Cancel active subscription
   - Location: `utils/api.ts` (lines 604-638)

### **Backend Files**

1. **`backend/models/Subscription.js`**
   - MongoDB schema for subscription data
   - Tracks: trial dates, Razorpay IDs, status, billing dates
   - Methods: `isActive()`, `isTrialActive()`, `isTrialExpired()`
   - Location: `backend/models/Subscription.js`

2. **`backend/models/Payment.js`**
   - MongoDB schema for payment transactions
   - Tracks: payment IDs, amounts, status, webhook events
   - Location: `backend/models/Payment.js`

3. **`backend/routes/subscription.js`**
   - Main subscription API routes:
     - `GET /api/subscription/status` - Get subscription status
     - `POST /api/subscription/create-subscription` - Create subscription
     - `POST /api/subscription/verify-payment` - Verify payment
     - `POST /api/subscription/cancel` - Cancel subscription
   - Location: `backend/routes/subscription.js`

4. **`backend/routes/razorpayWebhook.js`**
   - Webhook handler for Razorpay events
   - Handles: payment.captured, payment.failed, subscription.charged, etc.
   - Location: `backend/routes/razorpayWebhook.js`

5. **`backend/server.js`**
   - Registers subscription and webhook routes
   - Lines 194-197: Route registration
   - Location: `backend/server.js`

### **Documentation**

1. **`RAZORPAY_SETUP.md`**
   - Complete setup guide
   - Environment variables, testing, troubleshooting
   - Location: `RAZORPAY_SETUP.md`

---

## 🔄 How It Works - Complete Flow

### **1. User Access Flow**

```
User Opens Therapy Progress
         ↓
TherapyProgress.tsx checks subscription status
         ↓
    Has Access?
    ├─ YES → Show Therapy Progress Screen
    └─ NO  → Show Paywall Component
```

**Code Location**: `app/(tabs)/TherapyProgress.tsx` (lines 80-120)

```typescript
// Check subscription access on mount
useEffect(() => {
  checkSubscriptionAccess();
}, []);

const checkSubscriptionAccess = async () => {
  const status = await getSubscriptionStatus();
  setSubscriptionStatus(status);
  
  if (status.hasAccess) {
    await fetchData(); // Load therapy data
  } else {
    // Paywall will be shown
  }
};

// Show Paywall if no access
if (!subscriptionStatus?.hasAccess) {
  return <Paywall onSuccess={checkSubscriptionAccess} />;
}
```

### **2. Subscription Status Check**

**API Endpoint**: `GET /api/subscription/status`

**Backend Logic** (`backend/routes/subscription.js` lines 443-551):

1. **Check Free Access** (whitelist/localhost):
   ```javascript
   if (hasFreeAccess(auth0Id)) {
     return { hasAccess: true, status: 'free', isFreeAccess: true };
   }
   ```

2. **Get/Create Subscription**:
   - If new user → Creates 7-day free trial automatically
   - If existing user → Returns current subscription

3. **Check Access**:
   - Trial active? → `hasAccess: true`
   - Paid subscription active? → `hasAccess: true`
   - Trial expired + no subscription? → `hasAccess: false`

**Response Format**:
```json
{
  "ok": true,
  "hasAccess": true,
  "status": "trial" | "active" | "expired" | "cancelled" | "past_due",
  "isTrial": true,
  "isActive": true,
  "trialEndDate": "2024-01-15T00:00:00.000Z",
  "subscriptionEndDate": null,
  "nextBillingDate": null,
  "razorpaySubscriptionId": null
}
```

### **3. Subscription Creation Flow**

**When User Clicks "Subscribe Now"**:

```
User clicks Subscribe
         ↓
Paywall.tsx calls createSubscription()
         ↓
Backend creates Razorpay subscription
         ↓
Returns subscriptionId
         ↓
Frontend opens Razorpay Checkout
         ↓
User completes payment
         ↓
Razorpay calls handler function
         ↓
Frontend calls verifyPayment()
         ↓
Backend verifies signature & updates DB
         ↓
Access granted!
```

**Code Locations**:
- Frontend: `components/Paywall.tsx` (lines 46-99)
- Backend: `backend/routes/subscription.js` (lines 209-347)

**Step-by-Step**:

1. **Frontend** (`Paywall.tsx` line 51):
   ```typescript
   const subscriptionData = await createSubscription();
   ```

2. **Backend** (`subscription.js` line 209):
   - Creates Razorpay plan (if not exists)
   - Creates Razorpay customer
   - Creates Razorpay subscription
   - Updates database subscription record
   - Returns `subscriptionId`

3. **Frontend** (`Paywall.tsx` line 112):
   ```typescript
   const razorpay = new window.Razorpay({
     key: process.env.EXPO_PUBLIC_RAZORPAY_KEY_ID,
     subscription_id: subscriptionData.subscriptionId,
     handler: async function (response) {
       await verifyPayment({
         razorpay_payment_id: response.razorpay_payment_id,
         razorpay_subscription_id: response.razorpay_subscription_id,
         razorpay_signature: response.razorpay_signature,
       });
     }
   });
   razorpay.open();
   ```

4. **Backend Verification** (`subscription.js` line 353):
   - Verifies payment signature
   - Fetches payment from Razorpay
   - Updates subscription status to `active`
   - Records payment in database
   - Sets next billing date

### **4. Webhook Flow (Automatic Updates)**

**Razorpay sends webhooks for events**:

```
Razorpay Event Occurs
         ↓
POST to /api/webhooks/razorpay
         ↓
Backend verifies webhook signature
         ↓
Processes event:
  - payment.captured → Activate subscription
  - payment.failed → Mark as past_due
  - subscription.charged → Extend subscription
  - subscription.cancelled → Cancel subscription
         ↓
Updates database
```

**Code Location**: `backend/routes/razorpayWebhook.js`

**Events Handled**:
- `payment.captured` (line 127) - Payment successful
- `payment.failed` (line 197) - Payment failed
- `subscription.activated` (line 258) - Subscription activated
- `subscription.cancelled` (line 287) - Subscription cancelled
- `subscription.charged` (line 309) - Monthly auto-renewal
- `subscription.paused` (line 340) - Subscription paused
- `subscription.resumed` (line 361) - Subscription resumed

**Webhook Security**:
- Signature verification using `RAZORPAY_WEBHOOK_SECRET`
- Code: `backend/routes/razorpayWebhook.js` (lines 37-73)

### **5. Free Access System**

**Who Gets Free Access?**:

1. **Whitelisted Users** (`FREE_ACCESS_IDS` env variable)
2. **Localhost Development** (if Razorpay keys not configured)
3. **Test Mode** (if using test Razorpay keys)

**Code Location**: `backend/routes/subscription.js` (lines 100-149)

```javascript
function hasFreeAccess(auth0Id) {
  // Check whitelist
  if (FREE_ACCESS_IDS.includes(auth0Id)) return true;
  
  // Check if no Razorpay keys (localhost)
  if (!hasRazorpayKeys) return true;
  
  // Check if test keys
  if (isTestKey) return true;
  
  return false;
}
```

**To Add Free Access**:
- Set `FREE_ACCESS_IDS=auth0|user_id_1,auth0|user_id_2` in backend `.env`
- Or add to array in `subscription.js` line 46

---

## 💾 Database Schema

### **Subscription Collection**

**Fields**:
- `userId` - MongoDB ObjectId reference to User
- `auth0Id` - Auth0 user ID (string)
- `trialStartDate` - When trial started
- `trialEndDate` - When trial ends (7 days from start)
- `trialUsed` - Boolean (trial has been used)
- `razorpaySubscriptionId` - Razorpay subscription ID
- `razorpayPlanId` - Razorpay plan ID
- `razorpayCustomerId` - Razorpay customer ID
- `status` - 'trial' | 'active' | 'expired' | 'cancelled' | 'past_due'
- `subscriptionStartDate` - When paid subscription started
- `subscriptionEndDate` - When subscription expires
- `nextBillingDate` - Next automatic charge date
- `cancelledAt` - When cancelled
- `cancelReason` - Reason for cancellation

**Location**: `backend/models/Subscription.js`

### **Payment Collection**

**Fields**:
- `userId` - MongoDB ObjectId reference to User
- `auth0Id` - Auth0 user ID
- `subscriptionId` - Reference to Subscription
- `razorpayPaymentId` - Razorpay payment ID (unique)
- `razorpayOrderId` - Razorpay order ID
- `razorpaySubscriptionId` - Razorpay subscription ID
- `amount` - Amount in paise (smallest currency unit)
- `amountInRupees` - Amount in rupees
- `currency` - Currency code (default: 'INR')
- `status` - 'created' | 'authorized' | 'captured' | 'refunded' | 'failed'
- `method` - Payment method ('card', 'upi', 'netbanking', etc.)
- `paidAt` - When payment was captured
- `failureReason` - Why payment failed (if failed)
- `webhookReceived` - Boolean (webhook processed)
- `webhookProcessedAt` - When webhook was processed

**Location**: `backend/models/Payment.js`

---

## 🔐 Security Features

1. **Payment Signature Verification**:
   - All payments verified using HMAC SHA256
   - Code: `backend/routes/subscription.js` (lines 369-381)

2. **Webhook Signature Verification**:
   - All webhooks verified before processing
   - Code: `backend/routes/razorpayWebhook.js` (lines 37-73)

3. **Auth0 Authentication**:
   - All subscription routes require authentication
   - Code: `backend/server.js` (line 194)

4. **Environment Variables**:
   - Secret keys never exposed to frontend
   - Only public key ID in frontend

---

## 🧪 Testing

### **Test Cards (Razorpay Test Mode)**

- **Success**: `4111 1111 1111 1111`
- **Failure**: `4000 0000 0000 0002`
- CVV: Any 3 digits
- Expiry: Any future date

### **Test Flow**

1. **New User**:
   - Sign up → Trial automatically created
   - Can access Therapy Progress immediately
   - Trial shows 7 days remaining

2. **Trial Expired**:
   - After 7 days → Paywall shown
   - Click "Subscribe Now"
   - Complete payment with test card
   - Access restored

3. **Free Access (Development)**:
   - Add your Auth0 ID to `FREE_ACCESS_IDS`
   - Or run without Razorpay keys (localhost)
   - Always has access

### **Disable Free Access for Testing**

Set in backend `.env`:
```env
DISABLE_FREE_ACCESS_FOR_TESTING=true
```

Or modify `backend/routes/subscription.js` line 42:
```javascript
const FORCE_DISABLE_FREE_ACCESS = true;
```

---

## 📊 Current Status Check

### **Is It Working?**

**Check These**:

1. **Environment Variables** (Backend `.env`):
   ```env
   RAZORPAY_KEY_ID=rzp_test_xxxxx
   RAZORPAY_KEY_SECRET=xxxxx
   RAZORPAY_WEBHOOK_SECRET=xxxxx
   ```

2. **Frontend Environment** (`.env` or `app.json`):
   ```env
   EXPO_PUBLIC_RAZORPAY_KEY_ID=rzp_test_xxxxx
   ```

3. **Webhook URL** (Razorpay Dashboard):
   - Should be: `https://your-backend-url.com/api/webhooks/razorpay`
   - Events: payment.captured, payment.failed, subscription.charged, etc.

4. **Database Collections**:
   - `subscriptions` collection exists
   - `payments` collection exists

### **Common Issues**

1. **"Failed to create subscription plan"**:
   - Solution: Set `RAZORPAY_PLAN_ID` in env or check API keys

2. **"Webhook signature verification failed"**:
   - Solution: Check `RAZORPAY_WEBHOOK_SECRET` matches dashboard

3. **"Payment verification failed"**:
   - Solution: Check signature generation in frontend

4. **Trial not starting**:
   - Solution: Check `/api/subscription/status` is called on login

---

## 🎯 Key Configuration

### **Subscription Plan**

- **Amount**: ₹299/month (29900 paise)
- **Interval**: Monthly
- **Trial**: 7 days free
- **Auto-renewal**: Yes (until cancelled)

**Code**: `backend/routes/subscription.js` (lines 36-37)

### **Access Control Logic**

User has access if:
1. ✅ In 7-day free trial period, OR
2. ✅ Has active paid subscription, OR
3. ✅ In FREE_ACCESS_IDS whitelist

**Code**: `backend/routes/subscription.js` (lines 154-202)

---

## 📝 Summary

**Payment Gateway**: Razorpay  
**Subscription Model**: Monthly recurring (₹299/month)  
**Trial Period**: 7 days free  
**Access Control**: Subscription-based (trial or paid)  
**Webhook Support**: Yes (automatic payment tracking)  
**Security**: Signature verification, Auth0 authentication  
**Status**: ✅ Fully implemented and working

**Main Entry Points**:
- Frontend: `app/(tabs)/TherapyProgress.tsx` (access check)
- Frontend: `components/Paywall.tsx` (subscription UI)
- Backend: `backend/routes/subscription.js` (API routes)
- Backend: `backend/routes/razorpayWebhook.js` (webhook handler)

**Documentation**: See `RAZORPAY_SETUP.md` for detailed setup instructions.





