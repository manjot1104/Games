# ₹5 दिखने की Problem Fix करें

## Problem
Razorpay checkout में **₹5** दिख रहा है क्योंकि Razorpay dashboard में existing plan ₹5 के साथ create है।

## Root Cause
- `.env` file में `RAZORPAY_PLAN_ID` set है
- वो plan Razorpay dashboard में ₹5 amount के साथ create है
- Subscription checkout plan से amount automatically लेता है

## Solution - 2 Options

### Option 1: Code से नया Plan Create करें (Easiest) ✅

1. **Backend `.env` file edit करें**:
   ```powershell
   notepad backend\.env
   ```

2. **`RAZORPAY_PLAN_ID` line को comment करें या delete करें**:
   ```env
   # RAZORPAY_PLAN_ID=plan_xxxxxxxxxxxxx  # इस line को comment करें
   ```
   या पूरी line delete करें

3. **Server restart करें**:
   ```powershell
   # Server stop करें (Ctrl+C)
   # फिर restart करें
   cd backend
   npm start
   ```

4. **Subscribe button click करें**:
   - Code automatically नया plan ₹59 के साथ create करेगा
   - Console में plan ID दिखेगा: `Created Razorpay plan: plan_xxxxx`

5. **Plan ID save करें (Optional)**:
   - Console में दिखने वाला plan ID copy करें
   - `.env` file में add करें:
   ```env
   RAZORPAY_PLAN_ID=plan_xxxxx  # नया plan ID
   ```

### Option 2: Razorpay Dashboard में नया Plan Create करें

1. **Razorpay Dashboard में जाएं**:
   - https://dashboard.razorpay.com/app/plans
   - Login करें

2. **नया Plan Create करें**:
   - "Create Plan" button click करें
   - **Plan Name**: "Monthly Therapy Access - ₹59"
   - **Amount**: ₹59.00 (5900 paise)
   - **Billing Period**: Monthly
   - **Interval**: 1 month
   - Create करें

3. **Plan ID Copy करें**:
   - नए plan का ID copy करें (format: `plan_xxxxxxxxxxxxx`)

4. **Backend `.env` file update करें**:
   ```env
   RAZORPAY_PLAN_ID=plan_xxxxxxxxxxxxx  # नया plan ID यहाँ paste करें
   ```

5. **Server restart करें**

## Verification

1. **Browser में test करें**:
   - Paywall page open करें
   - "Subscribe Now" button click करें
   - Razorpay checkout में amount check करें
   - **₹59** दिखना चाहिए (₹5 नहीं)

2. **Backend logs check करें**:
   ```
   [CREATE SUBSCRIPTION] Created Razorpay plan: plan_xxxxx
   ```
   या
   ```
   [CREATE SUBSCRIPTION] Using existing plan: plan_xxxxx
   ```

## Important Notes

- ⚠️ **Old plan को delete न करें** - अगर existing subscriptions हैं तो
- ✅ **नया plan create करें** - ₹59 के साथ
- ✅ **Server restart करना जरूरी है** - .env changes के बाद
- ✅ **Test payment करें** - verify करने के लिए

## Current Status

- **Backend Code**: `MONTHLY_PLAN_AMOUNT = 5900` (₹59) ✅ Correct
- **Frontend Display**: ₹59 ✅ Fixed
- **Razorpay Plan**: ₹5 ❌ Needs update (या ₹299)

## Quick Fix (Recommended)

```powershell
# 1. .env file edit करें
notepad backend\.env

# 2. RAZORPAY_PLAN_ID line को comment करें या delete करें
# 3. Server restart करें
# 4. Subscribe button click करें - नया plan ₹59 के साथ create होगा
```
