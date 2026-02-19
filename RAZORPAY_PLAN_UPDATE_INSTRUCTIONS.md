# Razorpay Plan Update - ₹299 से ₹59 में Change करने के लिए

## Problem
Razorpay checkout में ₹299 दिख रहा है क्योंकि existing plan ₹299 के साथ create हुआ था। Razorpay में plan amount change नहीं हो सकती, इसलिए नया plan create करना होगा।

## Solution - 2 Options

### Option 1: नया Plan Create करें (Recommended)

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

4. **Backend .env file update करें**:
   ```env
   RAZORPAY_PLAN_ID=plan_xxxxxxxxxxxxx  # नया plan ID यहाँ paste करें
   ```

5. **Server restart करें**:
   ```powershell
   # Server stop करें (Ctrl+C)
   # फिर restart करें
   cd backend
   npm start
   ```

### Option 2: Code से Auto-Create होने दें

1. **Backend .env file से RAZORPAY_PLAN_ID remove करें**:
   ```env
   # RAZORPAY_PLAN_ID=plan_xxxxxxxxxxxxx  # इस line को comment करें या delete करें
   ```

2. **Server restart करें**:
   - Code automatically नया plan ₹59 के साथ create करेगा
   - Console में plan ID दिखेगा - उसे note कर लें

3. **Optional: Plan ID save करें**:
   - Console में दिखने वाला plan ID copy करें
   - `.env` file में `RAZORPAY_PLAN_ID` set करें (future के लिए)

## Verification

1. **Browser में test करें**:
   - Paywall page open करें
   - "Subscribe Now" button click करें
   - Razorpay checkout में amount check करें
   - **₹59** दिखना चाहिए (₹299 नहीं)

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

## Current Configuration

- **Backend Code**: `MONTHLY_PLAN_AMOUNT = 5900` (₹59) ✅ Correct
- **Frontend Display**: ₹59 ✅ Fixed
- **Razorpay Plan**: ₹299 ❌ Needs update

## Quick Fix Command

```powershell
# .env file edit करें
notepad backend\.env

# RAZORPAY_PLAN_ID line को comment करें या delete करें
# फिर server restart करें
```
