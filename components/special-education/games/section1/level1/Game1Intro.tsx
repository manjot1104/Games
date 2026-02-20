import { Ionicons } from '@expo/vector-icons';
import * as Speech from 'expo-speech';
import React, { useEffect, useState, useRef } from 'react';
import {
  ActivityIndicator,
  Platform,
  SafeAreaView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSpring,
  withTiming,
  Easing,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { useSpecialEducationProgress } from '../../../shared/SpecialEducationProgress';

const DEFAULT_TTS_RATE = 0.6; // Slower, calmer rate for special education

interface Game1IntroProps {
  onBack: () => void;
  onComplete: () => void;
  section: number;
  level: number;
}

export function Game1Intro({ onBack, onComplete, section, level }: Game1IntroProps) {
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const { markGameComplete } = useSpecialEducationProgress();
  const [currentContent, setCurrentContent] = useState<'letter' | 'number'>('letter');
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [hasCompleted, setHasCompleted] = useState(false);
  const speechTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Animation values
  const letterScale = useSharedValue(1);
  const numberScale = useSharedValue(1);
  const sparkleOpacity = useSharedValue(0);

  // Letter A content
  const letterContent = {
    symbol: 'A',
    sound: 'ah',
    description: 'This is the letter A. A says "ah".',
    color: '#3B82F6',
  };

  // Number 1 content
  const numberContent = {
    symbol: '1',
    sound: 'one',
    description: 'This is the number 1. One.',
    color: '#10B981',
  };

  const speak = (text: string) => {
    Speech.stop();
    setIsSpeaking(true);
    
    if (Platform.OS === 'web') {
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = DEFAULT_TTS_RATE;
      utterance.pitch = 1.0;
      utterance.volume = 1.0;
      utterance.onend = () => setIsSpeaking(false);
      utterance.onerror = () => setIsSpeaking(false);
      window.speechSynthesis.speak(utterance);
    } else {
      Speech.speak(text, {
        rate: DEFAULT_TTS_RATE,
        pitch: 1.0,
        onDone: () => setIsSpeaking(false),
        onStopped: () => setIsSpeaking(false),
      });
    }
  };

  useEffect(() => {
    // Start with letter A
    const timer = setTimeout(() => {
      speak(letterContent.description);
      letterScale.value = withRepeat(
        withSpring(1.1, { damping: 8, stiffness: 100 }),
        2,
        true
      );
    }, 500);

    // After letter, show number
    const numberTimer = setTimeout(() => {
      setCurrentContent('number');
      speak(numberContent.description);
      numberScale.value = withRepeat(
        withSpring(1.1, { damping: 8, stiffness: 100 }),
        2,
        true
      );
    }, 8000);

    // Auto-complete after both shown
    const completeTimer = setTimeout(async () => {
      setHasCompleted(true);
      sparkleOpacity.value = withTiming(1, { duration: 500 });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      
      // Mark game as completed in backend
      try {
        await markGameComplete(section, level, 1, 100);
      } catch (error) {
        console.error('Failed to save progress:', error);
      }
      
      // Auto-advance after celebration
      setTimeout(() => {
        onComplete();
      }, 2000);
    }, 16000);

    return () => {
      clearTimeout(timer);
      clearTimeout(numberTimer);
      clearTimeout(completeTimer);
      Speech.stop();
      if (Platform.OS === 'web') {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  const handleTap = () => {
    if (currentContent === 'letter') {
      speak(letterContent.description);
      letterScale.value = withSpring(1.2, { damping: 6 }, () => {
        letterScale.value = withSpring(1);
      });
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } else {
      speak(numberContent.description);
      numberScale.value = withSpring(1.2, { damping: 6 }, () => {
        numberScale.value = withSpring(1);
      });
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
  };

  const letterAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: letterScale.value }],
  }));

  const numberAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: numberScale.value }],
  }));

  const sparkleAnimatedStyle = useAnimatedStyle(() => ({
    opacity: sparkleOpacity.value,
  }));

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color="#0F172A" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Game 1: The Intro</Text>
        <View style={{ width: 40 }} />
      </View>

      <View style={styles.content}>
        {currentContent === 'letter' ? (
          <TouchableOpacity
            style={styles.symbolContainer}
            onPress={handleTap}
            activeOpacity={0.9}
          >
            <Animated.View
              style={[
                styles.symbolWrapper,
                { backgroundColor: `${letterContent.color}20` },
                letterAnimatedStyle,
              ]}
            >
              <Text style={[styles.symbol, { color: letterContent.color }]}>
                {letterContent.symbol}
              </Text>
            </Animated.View>
            <Text style={styles.description}>{letterContent.description}</Text>
            {isSpeaking && (
              <View style={styles.speakingIndicator}>
                <ActivityIndicator size="small" color={letterContent.color} />
                <Text style={styles.speakingText}>Speaking...</Text>
              </View>
            )}
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={styles.symbolContainer}
            onPress={handleTap}
            activeOpacity={0.9}
          >
            <Animated.View
              style={[
                styles.symbolWrapper,
                { backgroundColor: `${numberContent.color}20` },
                numberAnimatedStyle,
              ]}
            >
              <Text style={[styles.symbol, { color: numberContent.color }]}>
                {numberContent.symbol}
              </Text>
            </Animated.View>
            <Text style={styles.description}>{numberContent.description}</Text>
            {isSpeaking && (
              <View style={styles.speakingIndicator}>
                <ActivityIndicator size="small" color={numberContent.color} />
                <Text style={styles.speakingText}>Speaking...</Text>
              </View>
            )}
          </TouchableOpacity>
        )}

        {hasCompleted && (
          <Animated.View style={[styles.celebration, sparkleAnimatedStyle]}>
            <Text style={styles.celebrationEmoji}>✨</Text>
            <Text style={styles.celebrationText}>Great job!</Text>
          </Animated.View>
        )}

        <View style={styles.instructionContainer}>
          <Text style={styles.instructionText}>
            Tap the {currentContent === 'letter' ? 'letter' : 'number'} to hear it again
          </Text>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8FAFC',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#FFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
  },
  backButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#0F172A',
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  symbolContainer: {
    alignItems: 'center',
    width: '100%',
  },
  symbolWrapper: {
    width: 200,
    height: 200,
    borderRadius: 100,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 32,
    borderWidth: 4,
  },
  symbol: {
    fontSize: 120,
    fontWeight: '900',
    fontFamily: Platform.OS === 'ios' ? 'System' : 'sans-serif-medium',
  },
  description: {
    fontSize: 24,
    fontWeight: '700',
    color: '#0F172A',
    textAlign: 'center',
    marginBottom: 16,
    lineHeight: 32,
  },
  speakingIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 8,
  },
  speakingText: {
    fontSize: 14,
    color: '#64748B',
    fontWeight: '600',
  },
  celebration: {
    alignItems: 'center',
    marginTop: 32,
  },
  celebrationEmoji: {
    fontSize: 48,
    marginBottom: 8,
  },
  celebrationText: {
    fontSize: 20,
    fontWeight: '800',
    color: '#10B981',
  },
  instructionContainer: {
    position: 'absolute',
    bottom: 40,
    left: 24,
    right: 24,
    backgroundColor: 'rgba(255, 255, 255, 0.9)',
    padding: 16,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: '#E2E8F0',
  },
  instructionText: {
    fontSize: 14,
    color: '#475569',
    textAlign: 'center',
    fontWeight: '600',
  },
});

