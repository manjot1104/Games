# 🔧 Razorpay Keys Troubleshooting

Agar aapko abhi bhi "mock subscription" dikh raha hai, to yeh steps follow karo:

## ✅ Step 1: Check .env File Location

`.env` file **backend folder** me honi chahiye, root me nahi!

```
✅ Correct:
backend/.env

❌ Wrong:
.env (root directory)
```

## ✅ Step 2: Check .env File Format

`backend/.env` file me keys is format me honi chahiye:

```env
RAZORPAY_KEY_ID=rzp_live_xxxxxxxxxxxxx
RAZORPAY_KEY_SECRET=your_secret_key_here
```

**Common Mistakes:**
- ❌ `RAZORPAY_KEY_ID = rzp_live_...` (spaces around =)
- ❌ `RAZORPAY_KEY_ID="rzp_live_..."` (quotes - remove them)
- ❌ `RAZORPAY_KEY_ID=rzp_live_...` (extra spaces at end)

**Correct:**
- ✅ `RAZORPAY_KEY_ID=rzp_live_xxxxxxxxxxxxx` (no spaces, no quotes)

## ✅ Step 3: Verify Keys are Loaded

Backend folder me jao aur yeh command run karo:

```bash
cd backend
node check-razorpay-keys.js
```

Agar keys properly set hain, to yeh dikhega:
```
✅ RAZORPAY_KEY_ID: SET (rzp_live_...)
✅ RAZORPAY_KEY_SECRET: SET (hidden)
✅ Razorpay keys are properly configured!
```

Agar keys set nahi hain, to yeh dikhega:
```
❌ RAZORPAY_KEY_ID: NOT SET
❌ RAZORPAY_KEY_SECRET: NOT SET
```

## ✅ Step 4: Restart Backend Server

**IMPORTANT**: `.env` file me changes karne ke baad backend server **restart** karna zaroori hai!

1. Backend server stop karo (Ctrl+C)
2. Phir se start karo:
   ```bash
   cd backend
   npm start
   # ya
   npm run dev
   ```

## ✅ Step 5: Check Backend Logs

Backend server start karte waqt console me yeh dikhna chahiye:

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

To keys properly load nahi ho rahi hain.

## ✅ Step 6: Test Payment Flow

1. Frontend me payment button click karo
2. Backend console me check karo - yeh dikhna chahiye:
   ```
   [CREATE SUBSCRIPTION] Checking Razorpay keys...
   [CREATE SUBSCRIPTION] RAZORPAY_KEY_ID exists: true
   [CREATE SUBSCRIPTION] Has valid keys: true
   [CREATE SUBSCRIPTION] Razorpay keys found - proceeding with real subscription creation
   ```

Agar abhi bhi mock response aa raha hai, to backend logs check karo.

## 🐛 Common Issues

### Issue 1: Keys Root .env me hain
**Solution**: Keys ko `backend/.env` me move karo

### Issue 2: Extra Spaces
**Solution**: `.env` file me spaces remove karo:
```env
# Wrong
RAZORPAY_KEY_ID = rzp_live_...

# Correct
RAZORPAY_KEY_ID=rzp_live_...
```

### Issue 3: Quotes Around Values
**Solution**: Quotes remove karo:
```env
# Wrong
RAZORPAY_KEY_ID="rzp_live_..."

# Correct
RAZORPAY_KEY_ID=rzp_live_...
```

### Issue 4: Server Not Restarted
**Solution**: Backend server restart karo after adding keys

### Issue 5: Wrong Key Format
**Solution**: Keys `rzp_live_` ya `rzp_test_` se start honi chahiye

## 📝 Quick Checklist

- [ ] `.env` file `backend/` folder me hai
- [ ] Keys me spaces nahi hain
- [ ] Keys me quotes nahi hain
- [ ] Backend server restart kiya
- [ ] Backend logs me keys "SET" dikh rahi hain
- [ ] `check-razorpay-keys.js` script keys detect kar raha hai

## 🆘 Still Not Working?

1. Backend console logs share karo
2. `backend/.env` file ka format check karo (keys visible mat karo publicly!)
3. Backend server restart karke phir try karo
