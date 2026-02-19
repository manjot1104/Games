# ₹5 अभी भी दिख रहा है - Complete Fix Guide

## Problem
`RAZORPAY_PLAN_ID` comment करने के बाद भी ₹5 दिख रहा है।

## Possible Causes

### 1. Server Restart नहीं हुआ ⚠️ (Most Common)
`.env` file में changes apply करने के लिए **server restart जरूरी है**।

### 2. Database में Old Subscription Record है
पुराना subscription record old plan ID use कर रहा होगा।

### 3. Browser Cache
Browser में old subscription data cache हो सकता है।

## Complete Fix Steps

### Step 1: Server Restart करें (CRITICAL!)

```powershell
# 1. Server stop करें (Ctrl+C)
# 2. Server restart करें
cd backend
npm start
```

### Step 2: Verify .env File

```powershell
# .env file check करें
notepad backend\.env

# यह line comment होनी चाहिए या delete होनी चाहिए:
# RAZORPAY_PLAN_ID=plan_xxxxxxxxxxxxx  # Commented out
```

### Step 3: Clear Old Subscription (If Exists)

अगर database में old subscription है, तो उसे clear करें:

**Option A: Code से automatically clear होगा**
- जब आप "Subscribe Now" click करेंगे
- Code automatically old subscription cancel करेगा
- नया subscription ₹59 के साथ create होगा

**Option B: Manually clear करें (MongoDB)**
```javascript
// MongoDB shell में:
use childwellness
db.subscriptions.updateMany(
  { status: 'created' },
  { $set: { razorpaySubscriptionId: null, razorpayPlanId: null } }
)
```

### Step 4: Check Server Logs

Server console में यह logs दिखने चाहिए:

```
[CREATE SUBSCRIPTION] Checking for RAZORPAY_PLAN_ID in env...
[CREATE SUBSCRIPTION] RAZORPAY_PLAN_ID from env: NOT SET
[CREATE SUBSCRIPTION] MONTHLY_PLAN_AMOUNT: 5900 paise (₹59)
[CREATE SUBSCRIPTION] RAZORPAY_PLAN_ID not set - creating new plan with amount: 5900 paise
[CREATE SUBSCRIPTION] ✅ Created new Razorpay plan: plan_xxxxx
[CREATE SUBSCRIPTION] Plan amount: 5900 paise (₹59)
[CREATE SUBSCRIPTION] ✅ Verified plan amount: { planAmount: 5900, planAmountInRupees: '₹59' }
```

### Step 5: Test Again

1. Browser में Paywall page open करें
2. "Subscribe Now" button click करें
3. Razorpay checkout में amount check करें
4. **₹59** दिखना चाहिए (₹5 नहीं)

## Debugging

### Check Server Logs For:

1. **Plan Creation**:
   ```
   [CREATE SUBSCRIPTION] ✅ Created new Razorpay plan: plan_xxxxx
   [CREATE SUBSCRIPTION] Plan amount: 5900 paise (₹59)
   ```

2. **Plan Verification**:
   ```
   [CREATE SUBSCRIPTION] ✅ Verified plan amount: { planAmount: 5900 }
   ```

3. **Warnings (अगर amount mismatch है)**:
   ```
   [CREATE SUBSCRIPTION] ❌ CRITICAL: Plan amount mismatch!
   [CREATE SUBSCRIPTION] Plan in Razorpay: 500 paise (₹5)
   [CREATE SUBSCRIPTION] Expected: 5900 paise (₹59)
   ```

### Check Browser Console For:

1. **Subscription Data**:
   ```javascript
   [PAYWALL] Subscription created: { subscriptionId: 'sub_xxxxx', amount: 59 }
   ```

2. **Razorpay Checkout**:
   ```javascript
   Opening Razorpay checkout with options: { subscription_id: 'sub_xxxxx' }
   ```

## If Still Showing ₹5

### Check These:

1. ✅ **Server restart हुआ है?** - `.env` changes के बाद restart जरूरी है
2. ✅ **Console logs check करें** - plan amount verify करें
3. ✅ **Browser cache clear करें** - Hard refresh (Ctrl+Shift+R)
4. ✅ **Database में old subscription clear करें** - Code automatically करेगा

### Force Clear Old Subscription:

अगर फिर भी problem है, तो database में manually clear करें:

```javascript
// MongoDB में:
db.subscriptions.updateMany(
  {},
  { $set: { razorpaySubscriptionId: null, razorpayPlanId: null, status: 'trial' } }
)
```

फिर server restart करें और फिर से try करें।

## Expected Behavior

1. **First Time (No Plan ID)**:
   - Code नया plan ₹59 के साथ create करेगा
   - Console में plan ID दिखेगा
   - Razorpay checkout में ₹59 दिखेगा

2. **Subsequent Times**:
   - Same plan ID use होगा (अगर .env में save किया)
   - या नया plan create होगा (अगर .env में नहीं है)

## Important Notes

- ⚠️ **Server restart जरूरी है** - `.env` changes apply करने के लिए
- ✅ **Console logs check करें** - plan amount verify करने के लिए
- ✅ **Browser cache clear करें** - old data remove करने के लिए
- ✅ **Database में old records clear करें** - fresh start के लिए
