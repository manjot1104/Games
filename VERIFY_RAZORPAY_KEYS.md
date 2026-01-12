# ✅ Razorpay Keys Verification Steps

Aapke logs me yeh dikh raha hai:
```
[CREATE SUBSCRIPTION] Razorpay keys not configured
```

Yeh iska matlab hai ki keys properly load nahi ho rahi. Yeh steps follow karo:

## Step 1: Check .env File Location

`.env` file **backend folder** me honi chahiye:

```
✅ Correct Location:
backend/.env

❌ Wrong Location:
.env (root directory)
```

## Step 2: Verify .env File Content

`backend/.env` file open karo aur check karo ki yeh lines hain:

```env
RAZORPAY_KEY_ID=rzp_live_xxxxxxxxxxxxx
RAZORPAY_KEY_SECRET=your_secret_key_here
```

**Important:**
- No spaces around `=`
- No quotes around values
- No extra spaces at end

## Step 3: Test Keys Loading

Backend folder me jao aur yeh command run karo:

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

## Step 4: Restart Backend Server

**CRITICAL**: `.env` file me changes ke baad backend server **MUST restart** karo!

1. Current server stop karo (Ctrl+C in terminal)
2. Phir se start karo:
   ```bash
   cd backend
   npm start
   ```

## Step 5: Check Server Startup Logs

Server start karte waqt **pehle hi** yeh messages dikhne chahiye:

```
[SUBSCRIPTION ROUTER] Router module loaded
[SUBSCRIPTION ROUTER] Initializing Razorpay...
[SUBSCRIPTION ROUTER] RAZORPAY_KEY_ID: rzp_live_...
[SUBSCRIPTION ROUTER] RAZORPAY_KEY_SECRET: SET (hidden)
[SUBSCRIPTION ROUTER] Has valid keys: true
[SUBSCRIPTION ROUTER] ✅ Razorpay initialized with valid keys
```

Agar yeh messages nahi dikh rahe, to:
- Server restart nahi hua
- Ya keys properly load nahi ho rahi

## Step 6: Test Payment Again

Server restart ke baad:
1. Frontend me payment button click karo
2. Backend logs me check karo - ab yeh dikhna chahiye:
   ```
   [CREATE SUBSCRIPTION] Checking Razorpay keys...
   [CREATE SUBSCRIPTION] RAZORPAY_KEY_ID exists: true
   [CREATE SUBSCRIPTION] Has valid keys: true
   [CREATE SUBSCRIPTION] Razorpay keys found - proceeding with real subscription creation
   ```

## Common Issues

### Issue 1: .env file wrong location
**Check**: `backend/.env` file exists? (not root `.env`)

### Issue 2: Keys format wrong
**Check**: No spaces, no quotes in `.env` file

### Issue 3: Server not restarted
**Solution**: Backend server restart karo

### Issue 4: Keys not in .env
**Check**: `backend/.env` me keys actually hain?

## Quick Test

Backend folder me yeh command run karo:

```bash
cd backend
node -e "require('dotenv').config(); console.log('Key ID:', process.env.RAZORPAY_KEY_ID ? 'SET' : 'NOT SET'); console.log('Key Secret:', process.env.RAZORPAY_KEY_SECRET ? 'SET' : 'NOT SET');"
```

Agar "NOT SET" dikhe, to keys properly load nahi ho rahi.
