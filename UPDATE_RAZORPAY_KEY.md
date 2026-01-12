# 🔑 Razorpay Key Update - app.json

## Problem
`app.json` me placeholder value hai: `"rzp_live_xxxxxxxxxxxxx"`
Actual Razorpay key ID se replace karna hoga.

## Solution

### Step 1: Backend `.env` se Key Copy Karo

`backend/.env` file me jo `RAZORPAY_KEY_ID` hai, wahi value copy karo.

Example:
```env
RAZORPAY_KEY_ID=rzp_live_ABC123XYZ456
```

### Step 2: app.json me Update Karo

`app.json` file me line 18 par jao aur placeholder ko actual key se replace karo:

**Before:**
```json
"EXPO_PUBLIC_RAZORPAY_KEY_ID": "rzp_live_xxxxxxxxxxxxx"
```

**After:**
```json
"EXPO_PUBLIC_RAZORPAY_KEY_ID": "rzp_live_ABC123XYZ456"
```

(Replace `rzp_live_ABC123XYZ456` with your actual key from backend `.env`)

### Step 3: App Restart Karo

**CRITICAL**: `app.json` me changes ke baad app **MUST restart** karo!

1. Expo dev server stop karo (Ctrl+C)
2. Phir se start karo:
   ```bash
   npm start
   ```

### Step 4: Verify Karo

Browser console me check karo - ab yeh dikhna chahiye:
```
[PAYWALL] EXPO_PUBLIC_RAZORPAY_KEY_ID from app.json extra: rzp_live_...
```

## Quick Fix

1. Open `app.json`
2. Line 18 par jao
3. `"rzp_live_xxxxxxxxxxxxx"` ko actual key se replace karo
4. Save karo
5. App restart karo

## Important

- Key ID same honi chahiye jo backend `.env` me hai
- No spaces, no quotes around value
- App restart zaroori hai!
