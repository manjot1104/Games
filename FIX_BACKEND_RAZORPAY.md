# 🔧 Backend Razorpay Keys Fix - Production

## Problem
Backend se mock subscription response aa raha hai:
```
[CREATE SUBSCRIPTION] Razorpay keys not configured - returning mock response
```

## Solution

### Step 1: Backend `.env` File Check Karo

`backend/.env` file me yeh lines honi chahiye:

```env
RAZORPAY_KEY_ID=rzp_live_xxxxxxxxxxxxx
RAZORPAY_KEY_SECRET=your_secret_key_here
```

**Important:**
- File location: `backend/.env` (backend folder me, root me nahi)
- No spaces around `=`
- No quotes around values
- Actual keys honi chahiye (not placeholder)

### Step 2: Get Keys from Razorpay Dashboard

1. https://dashboard.razorpay.com par login karo
2. **Settings** → **API Keys**
3. **LIVE MODE** keys copy karo:
   - Key ID: `rzp_live_xxxxxxxxxxxxx`
   - Key Secret: `xxxxxxxxxxxxx`

### Step 3: Update `backend/.env` File

`backend/.env` file me yeh add/update karo:

```env
# Razorpay LIVE Mode Keys (Production)
RAZORPAY_KEY_ID=rzp_live_xxxxxxxxxxxxx
RAZORPAY_KEY_SECRET=your_actual_secret_key_here
```

### Step 4: Verify Keys are Loaded

Backend folder me yeh command run karo:

```bash
cd backend
node check-razorpay-keys.js
```

Agar keys properly load ho rahi hain, to yeh dikhega:
```
✅ RAZORPAY_KEY_ID: SET (rzp_live_...)
✅ RAZORPAY_KEY_SECRET: SET (hidden)
✅ Razorpay keys are properly configured!
```

### Step 5: Backend Server Restart Karo

**CRITICAL**: `.env` file me changes ke baad backend server **MUST restart** karo!

1. Backend server stop karo (Ctrl+C)
2. Phir se start karo:
   ```bash
   cd backend
   npm start
   ```

### Step 6: Check Backend Startup Logs

Server start karte waqt console me yeh dikhna chahiye:

```
[SUBSCRIPTION ROUTER] Initializing Razorpay...
[SUBSCRIPTION ROUTER] RAZORPAY_KEY_ID: rzp_live_...
[SUBSCRIPTION ROUTER] RAZORPAY_KEY_SECRET: SET (hidden)
[SUBSCRIPTION ROUTER] Has valid keys: true
[SUBSCRIPTION ROUTER] ✅ Razorpay initialized with valid keys
```

Agar yeh dikhe:
```
[SUBSCRIPTION ROUTER] RAZORPAY_KEY_ID: NOT SET
[SUBSCRIPTION ROUTER] ⚠️ Razorpay initialized but keys are missing
```

To keys properly load nahi ho rahi.

### Step 7: Test Payment Flow

1. Frontend me payment button click karo
2. Backend console me check karo - ab yeh dikhna chahiye:
   ```
   [CREATE SUBSCRIPTION] Checking Razorpay keys...
   [CREATE SUBSCRIPTION] RAZORPAY_KEY_ID exists: true
   [CREATE SUBSCRIPTION] Has valid keys: true
   [CREATE SUBSCRIPTION] Razorpay keys found - proceeding with real subscription creation
   ```

## Common Issues

### Issue 1: `.env` file wrong location
**Check**: `backend/.env` file exists? (not root `.env`)

### Issue 2: Keys format wrong
**Check**: No spaces, no quotes in `.env` file

### Issue 3: Server not restarted
**Solution**: Backend server restart karo

### Issue 4: Keys not in `.env`
**Check**: `backend/.env` me keys actually hain?

### Issue 5: Wrong key format
**Check**: Key ID `rzp_live_` ya `rzp_test_` se start honi chahiye

## Quick Checklist

- [ ] `backend/.env` file me `RAZORPAY_KEY_ID` set hai
- [ ] `backend/.env` file me `RAZORPAY_KEY_SECRET` set hai
- [ ] Keys me spaces nahi hain
- [ ] Keys me quotes nahi hain
- [ ] Backend server restart kiya
- [ ] Backend logs me keys "SET" dikh rahi hain
- [ ] `check-razorpay-keys.js` script keys detect kar raha hai

## Still Not Working?

1. Backend console logs share karo
2. `backend/.env` file ka format check karo (keys visible mat karo publicly!)
3. Backend server restart karke phir try karo
