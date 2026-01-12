import { cancelSubscription, createSubscription, getSubscriptionStatus, syncSubscriptionStatus, verifyPayment, type SubscriptionStatus } from '@/utils/api';
import { Ionicons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import { useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    Platform,
    SafeAreaView,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';

/**
 * Paywall Component
 * Shows subscription options and handles Razorpay checkout
 * Displays when user's trial expires or subscription is inactive
 */
export default function Paywall({ onSuccess }: { onSuccess?: () => void }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<SubscriptionStatus | null>(null);
  const [checkingStatus, setCheckingStatus] = useState(true);

  // Load subscription status on mount
  useEffect(() => {
    loadStatus();
  }, []);

  const loadStatus = async () => {
    try {
      setCheckingStatus(true);
      const currentStatus = await getSubscriptionStatus();
      setStatus(currentStatus);
    } catch (error: any) {
      console.error('Failed to load subscription status:', error);
      Alert.alert('Error', 'Failed to load subscription status. Please try again.');
    } finally {
      setCheckingStatus(false);
    }
  };

  const handleSubscribe = async () => {
    if (loading) {
      console.log('Subscription already in progress, ignoring duplicate click');
      return;
    }

    setLoading(true);
    
    try {
      console.log('[PAYWALL] Starting subscription process...');
      
      // Step 1: Create subscription on backend
      const subscriptionData = await createSubscription();
      console.log('[PAYWALL] Subscription created:', subscriptionData);

      // Validate response
      if (!subscriptionData) {
        throw new Error('Invalid response from server');
      }

      // Check if user has free access (shouldn't create subscription)
      if ((subscriptionData as any).hasFreeAccess) {
        console.log('[PAYWALL] User has free access');
        setLoading(false); // Reset loading immediately
        loadStatus();
        onSuccess?.();
        Alert.alert('Info', 'You have free access. No subscription needed.');
        return;
      }

      // Check if this is a mock response (localhost development without Razorpay keys)
      if ((subscriptionData as any).mock) {
        console.log('[PAYWALL] Mock subscription response detected');
        setLoading(false); // Reset loading immediately
        Alert.alert(
          'Development Mode',
          'Razorpay keys are not configured. This is a mock subscription for localhost development. In production, configure RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET in your backend .env file.',
          [
            {
              text: 'OK',
              onPress: () => {
                // In development, we can still refresh status
                loadStatus();
              },
            },
          ]
        );
        return;
      }

      // Validate subscription data has required fields
      if (!subscriptionData.subscriptionId) {
        console.error('[PAYWALL] Missing subscriptionId in response:', subscriptionData);
        throw new Error('Invalid subscription data received from server. Please try again.');
      }

      // Step 2: Open Razorpay checkout
      if (Platform.OS === 'web') {
        // Web: Use Razorpay Checkout
        console.log('[PAYWALL] Opening Razorpay checkout for web...');
        await openRazorpayWebCheckout(subscriptionData);
      } else {
        // Mobile: Show message for now
        console.log('[PAYWALL] Mobile platform detected');
        Alert.alert(
          'Mobile Checkout',
          'Mobile checkout requires @razorpay/react-native package. Please use web version for subscription.',
          [{ text: 'OK', onPress: () => setLoading(false) }]
        );
      }
    } catch (error: any) {
      console.error('[PAYWALL] Subscription error:', error);
      const errorMessage = error.message || 'Failed to create subscription. Please try again.';
      Alert.alert('Error', errorMessage, [
        {
          text: 'OK',
          onPress: () => {
            setLoading(false);
          },
        },
      ]);
      // Ensure loading is reset even if alert is dismissed
      setLoading(false);
    }
  };

  /**
   * Open Razorpay checkout for web
   */
  const openRazorpayWebCheckout = async (subscriptionData: any) => {
    // For web, we'll use Razorpay's checkout.js
    if (typeof window === 'undefined' || typeof document === 'undefined') {
      Alert.alert('Error', 'Web checkout is only available on web platform.');
      setLoading(false);
      return;
    }

    // Validate subscription data
    if (!subscriptionData || !subscriptionData.subscriptionId) {
      console.error('Invalid subscription data:', subscriptionData);
      Alert.alert('Error', 'Invalid subscription data. Please try again.');
      setLoading(false);
      return;
    }

    // Validate Razorpay key - check both process.env and app.json extra
    const extra = (Constants as any).expoConfig?.extra ?? {};
    const razorpayKey = (process.env.EXPO_PUBLIC_RAZORPAY_KEY_ID as string) || (extra.EXPO_PUBLIC_RAZORPAY_KEY_ID as string) || '';
    console.log('[PAYWALL] Checking Razorpay key...');
    console.log('[PAYWALL] EXPO_PUBLIC_RAZORPAY_KEY_ID from process.env:', process.env.EXPO_PUBLIC_RAZORPAY_KEY_ID ? (process.env.EXPO_PUBLIC_RAZORPAY_KEY_ID.substring(0, 10) + '...') : 'NOT SET');
    console.log('[PAYWALL] EXPO_PUBLIC_RAZORPAY_KEY_ID from app.json extra:', extra.EXPO_PUBLIC_RAZORPAY_KEY_ID ? (extra.EXPO_PUBLIC_RAZORPAY_KEY_ID.substring(0, 10) + '...') : 'NOT SET');
    console.log('[PAYWALL] Final EXPO_PUBLIC_RAZORPAY_KEY_ID:', razorpayKey ? (razorpayKey.substring(0, 10) + '...') : 'NOT SET');
    
    if (!razorpayKey) {
      console.error('[PAYWALL] Razorpay key is missing');
      console.error('[PAYWALL] Please set EXPO_PUBLIC_RAZORPAY_KEY_ID in root .env file');
      Alert.alert(
        'Configuration Error',
        'Razorpay payment gateway is not configured. Please set EXPO_PUBLIC_RAZORPAY_KEY_ID in your .env file and restart the app.',
        [
          {
            text: 'OK',
            onPress: () => {
              setLoading(false);
            },
          },
        ]
      );
      setLoading(false);
      return;
    }
    
    console.log('[PAYWALL] Razorpay key found - proceeding with checkout');

    function openCheckout() {
      try {
        // Check if Razorpay is available
        if (!(window as any).Razorpay) {
          throw new Error('Razorpay SDK not loaded');
        }

        const options = {
          key: razorpayKey,
          subscription_id: subscriptionData.subscriptionId,
          name: 'Therapy Progress',
          description: 'Monthly subscription for Therapy Progress access',
          image: '', // Optional: your logo URL
          prefill: {
            email: '', // Get from user profile
            contact: '', // Get from user profile
          },
          theme: {
            color: '#8B5CF6',
          },
          handler: async function (response: any) {
            // Payment successful
            try {
              console.log('[PAYWALL] Payment response received:', response);
              console.log('[PAYWALL] Verifying payment...');
              
              const verificationResult = await verifyPayment({
                razorpay_payment_id: response.razorpay_payment_id,
                razorpay_subscription_id: response.razorpay_subscription_id,
                razorpay_signature: response.razorpay_signature,
              });

              console.log('[PAYWALL] Payment verification result:', verificationResult);

              // Wait a moment for backend to process
              await new Promise(resolve => setTimeout(resolve, 1000));

              // Try to sync status from Razorpay in case verification didn't update it
              try {
                console.log('[PAYWALL] Syncing subscription status from Razorpay...');
                await syncSubscriptionStatus();
              } catch (syncError) {
                console.warn('[PAYWALL] Status sync failed (may be normal):', syncError);
              }

              // Reload subscription status
              console.log('[PAYWALL] Reloading subscription status...');
              await loadStatus();

              Alert.alert('Success', 'Subscription activated successfully!', [
                {
                  text: 'OK',
                  onPress: () => {
                    setLoading(false);
                    // Call onSuccess callback to refresh parent component
                    onSuccess?.();
                  },
                },
              ]);
            } catch (err: any) {
              console.error('[PAYWALL] Payment verification error:', err);
              Alert.alert('Error', err.message || 'Payment verification failed. Please contact support.');
              setLoading(false);
            }
          },
          modal: {
            ondismiss: () => {
              console.log('Razorpay modal dismissed');
              setLoading(false);
            },
          },
        };

        console.log('Opening Razorpay checkout with options:', {
          key: razorpayKey.substring(0, 10) + '...',
          subscription_id: subscriptionData.subscriptionId,
        });

        const razorpay = new (window as any).Razorpay(options);
        
        // Add error handler
        razorpay.on('payment.failed', function (response: any) {
          console.error('Payment failed:', response);
          Alert.alert(
            'Payment Failed',
            response.error?.description || 'Your payment could not be processed. Please try again.'
          );
          setLoading(false);
        });

        razorpay.open();
      } catch (error: any) {
        console.error('Error opening Razorpay checkout:', error);
        Alert.alert('Error', error.message || 'Failed to open payment gateway. Please try again.');
        setLoading(false);
      }
    }

    // Check if Razorpay is already loaded
    if ((window as any).Razorpay) {
      openCheckout();
    } else {
      // Load Razorpay script
      const script = document.createElement('script');
      script.src = 'https://checkout.razorpay.com/v1/checkout.js';
      script.onload = () => {
        console.log('Razorpay script loaded successfully');
        // Small delay to ensure Razorpay is fully initialized
        setTimeout(() => {
          openCheckout();
        }, 100);
      };
      script.onerror = () => {
        console.error('Failed to load Razorpay script');
        Alert.alert('Error', 'Failed to load Razorpay checkout. Please check your internet connection and try again.');
        setLoading(false);
      };
      document.body.appendChild(script);
    }
  };

  // /**
  //  * Open Razorpay checkout for mobile
  //  * Note: This requires @razorpay/react-native package
  //  */
  // const openRazorpayMobileCheckout = async (subscriptionData: any) => {
  //   // For mobile, you would use:
  //   // import RazorpayCheckout from '@razorpay/react-native';
  //   // 
  //   // RazorpayCheckout.open({
  //   //   key: process.env.EXPO_PUBLIC_RAZORPAY_KEY_ID,
  //   //   subscription_id: subscriptionData.subscriptionId,
  //   //   // ... other options
  //   // });
  //   
  //   // For now, show alert that mobile checkout needs to be implemented
  //   Alert.alert(
  //     'Mobile Checkout',
  //     'Mobile checkout requires @razorpay/react-native package. Please implement using Razorpay React Native SDK.',
  //     [{ text: 'OK', onPress: () => setLoading(false) }]
  //   );
  // };

  const formatDate = (dateString: string | null) => {
    if (!dateString) return 'N/A';
    const date = new Date(dateString);
    return date.toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  };

  if (checkingStatus) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#8B5CF6" />
          <Text style={styles.loadingText}>Loading subscription status...</Text>
        </View>
      </SafeAreaView>
    );
  }

  // PRODUCTION MODE: No trial - payment required immediately

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
            <Ionicons name="arrow-back" size={24} color="#111827" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Subscription</Text>
          <View style={styles.placeholder} />
        </View>

        {/* Content */}
        <View style={styles.content}>
          {/* No Access Message - Production Mode (No Trial) */}
          {!status?.hasAccess && (
            <View style={[styles.card, styles.expiredCard]}>
              <Ionicons name="lock-closed" size={48} color="#EF4444" />
              <Text style={styles.cardTitle}>Subscription Required</Text>
              <Text style={styles.cardSubtitle}>
                Subscribe to access all Therapy Progress features
              </Text>
              <Text style={styles.cardDescription}>
                Choose a plan below to get started. Payment required immediately - no trial period.
              </Text>
            </View>
          )}

          {status?.status === 'past_due' && (
            <View style={[styles.card, styles.errorCard]}>
              <Ionicons name="alert-circle" size={48} color="#F59E0B" />
              <Text style={styles.cardTitle}>Payment Failed</Text>
              <Text style={styles.cardSubtitle}>
                Your last payment could not be processed
              </Text>
              <Text style={styles.cardDescription}>
                Please update your payment method to continue
              </Text>
            </View>
          )}

          {/* Subscription Plan Card */}
          <View style={[styles.card, styles.planCard]}>
            <Text style={styles.planTitle}>Monthly Subscription</Text>
            <View style={styles.priceContainer}>
              <Text style={styles.price}>₹299</Text>
              <Text style={styles.pricePeriod}>/month</Text>
            </View>
            <Text style={styles.planDescription}>
              Access to all Therapy Progress features
            </Text>

            {/* Features List */}
            <View style={styles.featuresList}>
              <View style={styles.featureItem}>
                <Ionicons name="checkmark-circle" size={20} color="#10B981" />
                <Text style={styles.featureText}>Unlimited therapy sessions</Text>
              </View>
              <View style={styles.featureItem}>
                <Ionicons name="checkmark-circle" size={20} color="#10B981" />
                <Text style={styles.featureText}>Progress tracking & insights</Text>
              </View>
              <View style={styles.featureItem}>
                <Ionicons name="checkmark-circle" size={20} color="#10B981" />
                <Text style={styles.featureText}>All therapy types included</Text>
              </View>
              <View style={styles.featureItem}>
                <Ionicons name="checkmark-circle" size={20} color="#10B981" />
                <Text style={styles.featureText}>Cancel anytime</Text>
              </View>
            </View>

            {/* Subscribe Button */}
            <TouchableOpacity
              style={[styles.subscribeButton, loading && styles.subscribeButtonDisabled]}
              onPress={handleSubscribe}
              disabled={loading}
            >
              {loading ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <>
                  <Text style={styles.subscribeButtonText}>Subscribe Now</Text>
                  <Ionicons name="arrow-forward" size={20} color="#FFFFFF" />
                </>
              )}
            </TouchableOpacity>

            <Text style={styles.termsText}>
              By subscribing, you agree to our Terms of Service and Privacy Policy.
              Subscription auto-renews monthly. Cancel anytime.
            </Text>

            {/* Manual Sync Button - for cases where payment succeeded but status not updated */}
            {status?.razorpaySubscriptionId && status?.status === 'created' && (
              <TouchableOpacity
                style={[styles.syncButton]}
                onPress={async () => {
                  try {
                    setLoading(true);
                    console.log('[PAYWALL] Manually syncing subscription status...');
                    await syncSubscriptionStatus();
                    await loadStatus();
                    Alert.alert('Success', 'Subscription status synced. Please refresh the page.');
                  } catch (error: any) {
                    console.error('[PAYWALL] Sync error:', error);
                    Alert.alert('Error', error.message || 'Failed to sync status. Please contact support.');
                  } finally {
                    setLoading(false);
                  }
                }}
                disabled={loading}
              >
                <Ionicons name="refresh" size={16} color="#8B5CF6" />
                <Text style={styles.syncButtonText}>Sync Payment Status</Text>
              </TouchableOpacity>
            )}
          </View>

          {/* Active Subscription Info */}
          {status?.status === 'active' && status?.subscriptionEndDate && (
            <View style={[styles.card, styles.activeCard]}>
              <Ionicons name="checkmark-circle" size={48} color="#10B981" />
              <Text style={styles.cardTitle}>Subscription Active</Text>
              <Text style={styles.cardSubtitle}>
                Next billing: {formatDate(status.nextBillingDate)}
              </Text>
              <TouchableOpacity
                style={styles.cancelButton}
                onPress={async () => {
                  Alert.alert(
                    'Cancel Subscription',
                    'Are you sure you want to cancel your subscription? You will lose access after the current billing period.',
                    [
                      { text: 'No', style: 'cancel' },
                      {
                        text: 'Yes, Cancel',
                        style: 'destructive',
                        onPress: async () => {
                          try {
                            await cancelSubscription();
                            Alert.alert('Success', 'Subscription cancelled successfully.');
                            loadStatus();
                          } catch (error: any) {
                            Alert.alert('Error', error.message || 'Failed to cancel subscription.');
                          }
                        },
                      },
                    ]
                  );
                }}
              >
                <Text style={styles.cancelButtonText}>Cancel Subscription</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F9FAFB',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 16,
    fontSize: 16,
    color: '#6B7280',
  },
  scrollContent: {
    flexGrow: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  backButton: {
    padding: 8,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#111827',
  },
  placeholder: {
    width: 40,
  },
  content: {
    padding: 16,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 24,
    marginBottom: 16,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 3,
  },
  trialCard: {
    borderWidth: 2,
    borderColor: '#10B981',
  },
  expiredCard: {
    borderWidth: 2,
    borderColor: '#EF4444',
  },
  errorCard: {
    borderWidth: 2,
    borderColor: '#F59E0B',
  },
  activeCard: {
    borderWidth: 2,
    borderColor: '#10B981',
  },
  planCard: {
    alignItems: 'flex-start',
  },
  cardTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#111827',
    marginTop: 16,
    textAlign: 'center',
  },
  cardSubtitle: {
    fontSize: 16,
    color: '#6B7280',
    marginTop: 8,
    textAlign: 'center',
  },
  cardDescription: {
    fontSize: 14,
    color: '#9CA3AF',
    marginTop: 8,
    textAlign: 'center',
  },
  planTitle: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#111827',
    marginBottom: 8,
  },
  priceContainer: {
    flexDirection: 'row',
    alignItems: 'baseline',
    marginBottom: 8,
  },
  price: {
    fontSize: 48,
    fontWeight: 'bold',
    color: '#8B5CF6',
  },
  pricePeriod: {
    fontSize: 20,
    color: '#6B7280',
    marginLeft: 8,
  },
  planDescription: {
    fontSize: 16,
    color: '#6B7280',
    marginBottom: 24,
  },
  featuresList: {
    width: '100%',
    marginBottom: 24,
  },
  featureItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  featureText: {
    fontSize: 16,
    color: '#374151',
    marginLeft: 12,
  },
  subscribeButton: {
    width: '100%',
    backgroundColor: '#8B5CF6',
    borderRadius: 12,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  subscribeButtonDisabled: {
    opacity: 0.6,
  },
  subscribeButtonText: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#FFFFFF',
    marginRight: 8,
  },
  termsText: {
    fontSize: 12,
    color: '#9CA3AF',
    textAlign: 'center',
    lineHeight: 18,
  },
  cancelButton: {
    marginTop: 16,
    padding: 12,
  },
  cancelButtonText: {
    fontSize: 16,
    color: '#EF4444',
    fontWeight: '600',
  },
  syncButton: {
    marginTop: 12,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F3F4F6',
    borderRadius: 8,
  },
  syncButtonText: {
    fontSize: 14,
    color: '#8B5CF6',
    fontWeight: '600',
    marginLeft: 8,
  },
});
