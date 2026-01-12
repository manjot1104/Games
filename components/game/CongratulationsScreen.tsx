/**
 * Congratulations Screen Component
 * A motivational screen shown after successfully completing a game
 * Features: Confetti animations on left/right, Wow sticker animation in center
 */

import React from 'react';
import { Platform, StyleSheet, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Lottie from 'lottie-react';

let NativeLottie: any = null;
if (Platform.OS !== 'web') {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  NativeLottie = require('lottie-react-native').default;
}

const wowAnimation = require('@/assets/animation/Wow! Sticker Animation.json');
const confettiAnimation = require('@/assets/animation/Confetti emoji.json');

type Props = {
  onContinue?: () => void;
  onHome?: () => void;
  message?: string;
  showButtons?: boolean;
  // Stats props (like ResultCard)
  correct?: number;
  total?: number;
  accuracy?: number;
  xpAwarded?: number;
};

export default function CongratulationsScreen({
  onContinue,
  onHome,
  message = 'Congratulations!',
  showButtons = true,
  correct,
  total,
  accuracy,
  xpAwarded,
}: Props) {
  const { width, height } = useWindowDimensions();
  const isTablet = width >= 768;
  const isMobile = width < 600;
  
  // Calculate accuracy percentage if not provided
  const accuracyPct = accuracy !== undefined 
    ? accuracy 
    : (correct !== undefined && total !== undefined && total > 0)
      ? Math.round((correct / total) * 100)
      : undefined;

  const renderLottie = (animationData: any, size: number, style?: any) => {
    if (Platform.OS === 'web') {
      // For web, merge styles into a single object (no arrays)
      const webStyle = { width: size, height: size, ...(style || {}) };
      return (
        <Lottie
          animationData={animationData}
          loop
          autoplay
          style={webStyle}
        />
      );
    }

    if (NativeLottie) {
      // For native, use array format
      return (
        <NativeLottie
          source={animationData}
          autoPlay
          loop
          style={[{ width: size, height: size }, style]}
        />
      );
    }

    return null;
  };

  const confettiSize = isTablet ? 200 : isMobile ? 120 : 160;
  const wowSize = isTablet ? 300 : isMobile ? 200 : 250;

  return (
    <View style={styles.container}>
      {/* Gradient Background */}
      <LinearGradient
        colors={['#FEF3C7', '#FDE68A', '#FCD34D', '#FBBF24']}
        style={StyleSheet.absoluteFillObject}
      />

      {/* Content Container */}
      <View style={styles.contentContainer}>
        {/* Top Section - Confetti and Wow Animation */}
        <View style={styles.animationContainer}>
          {/* Left Confetti */}
          <View style={[styles.confettiContainer, styles.leftConfetti]}>
            {renderLottie(confettiAnimation, confettiSize)}
          </View>

          {/* Center Wow Animation */}
          <View style={styles.wowContainer}>
            {renderLottie(wowAnimation, wowSize)}
          </View>

          {/* Right Confetti */}
          <View style={[styles.confettiContainer, styles.rightConfetti]}>
            {renderLottie(confettiAnimation, confettiSize)}
          </View>
        </View>

        {/* Message Section */}
        <View style={styles.messageContainer}>
          <Text 
            style={[
              styles.messageText, 
              isMobile && styles.messageTextMobile,
              Platform.OS === 'web' 
                ? { textShadow: '0 2px 4px rgba(255, 255, 255, 0.8)' }
                : {
                    textShadowColor: 'rgba(255, 255, 255, 0.8)',
                    textShadowOffset: { width: 0, height: 2 },
                    textShadowRadius: 4,
                  }
            ]}
          >
            {message}
          </Text>
          <Text style={[styles.subMessageText, isMobile && styles.subMessageTextMobile]}>
            You did an amazing job! 🎉
          </Text>
        </View>

        {/* Stats Section (like ResultCard) */}
        {(correct !== undefined || accuracyPct !== undefined || xpAwarded !== undefined) && (
          <View style={styles.statsContainer}>
            {correct !== undefined && total !== undefined && (
              <View style={styles.statRow}>
                <Text style={styles.statLabel}>Score</Text>
                <Text style={styles.statValue}>
                  {correct}/{total}
                </Text>
              </View>
            )}
            {accuracyPct !== undefined && (
              <View style={styles.statRow}>
                <Text style={styles.statLabel}>Accuracy</Text>
                <Text style={styles.statValue}>{accuracyPct}%</Text>
              </View>
            )}
            {xpAwarded !== undefined && (
              <View style={styles.statRow}>
                <Text style={styles.statLabel}>XP Earned</Text>
                <Text style={[styles.statValue, styles.xpValue]}>+{xpAwarded} XP</Text>
              </View>
            )}
          </View>
        )}

        {/* Buttons */}
        {showButtons && (
          <View style={styles.buttonContainer}>
            {onContinue && (
              <TouchableOpacity
                onPress={onContinue}
                activeOpacity={0.8}
                style={[
                  styles.button, 
                  styles.continueButton,
                  Platform.OS === 'web'
                    ? { boxShadow: '0 4px 8px rgba(0, 0, 0, 0.2)' }
                    : {
                        shadowColor: '#000',
                        shadowOpacity: 0.2,
                        shadowRadius: 8,
                        shadowOffset: { width: 0, height: 4 },
                        elevation: 6,
                      }
                ]}
              >
                <Text style={styles.buttonText}>Continue</Text>
              </TouchableOpacity>
            )}
            {onHome && (
              <TouchableOpacity
                onPress={onHome}
                activeOpacity={0.8}
                style={[
                  styles.button, 
                  styles.homeButton,
                  Platform.OS === 'web'
                    ? { boxShadow: '0 4px 8px rgba(0, 0, 0, 0.2)' }
                    : {
                        shadowColor: '#000',
                        shadowOpacity: 0.2,
                        shadowRadius: 8,
                        shadowOffset: { width: 0, height: 4 },
                        elevation: 6,
                      }
                ]}
              >
                <Text style={[styles.buttonText, styles.homeButtonText]}>Back to Games</Text>
              </TouchableOpacity>
            )}
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  contentContainer: {
    width: '100%',
    maxWidth: 600,
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  animationContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    marginBottom: 40,
    position: 'relative',
  },
  confettiContainer: {
    position: 'absolute',
    top: '50%',
    marginTop: -100,
  },
  leftConfetti: {
    left: 0,
  },
  rightConfetti: {
    right: 0,
  },
  wowContainer: {
    zIndex: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  messageContainer: {
    alignItems: 'center',
    marginBottom: 40,
    paddingHorizontal: 20,
  },
  messageText: {
    fontSize: 42,
    fontWeight: '900',
    color: '#92400E',
    textAlign: 'center',
    marginBottom: 12,
  },
  messageTextMobile: {
    fontSize: 32,
  },
  subMessageText: {
    fontSize: 20,
    fontWeight: '600',
    color: '#B45309',
    textAlign: 'center',
  },
  subMessageTextMobile: {
    fontSize: 16,
  },
  buttonContainer: {
    width: '100%',
    maxWidth: 400,
    gap: 12,
  },
  button: {
    paddingVertical: 16,
    paddingHorizontal: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  continueButton: {
    backgroundColor: '#10B981',
  },
  homeButton: {
    backgroundColor: '#FFFFFF',
    borderWidth: 2,
    borderColor: '#FCD34D',
  },
  buttonText: {
    fontSize: 18,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  homeButtonText: {
    color: '#92400E',
  },
  statsContainer: {
    width: '100%',
    maxWidth: 400,
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 20,
    marginBottom: 30,
    ...(Platform.OS === 'web'
      ? { boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)' }
      : {
          shadowColor: '#000',
          shadowOpacity: 0.1,
          shadowRadius: 12,
          shadowOffset: { width: 0, height: 4 },
          elevation: 4,
        }),
  },
  statRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  statLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: '#6B7280',
  },
  statValue: {
    fontSize: 20,
    fontWeight: '800',
    color: '#111827',
  },
  xpValue: {
    color: '#16A34A',
  },
});

