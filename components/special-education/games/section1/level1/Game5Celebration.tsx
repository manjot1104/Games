import { Ionicons } from '@expo/vector-icons';
import * as Speech from 'expo-speech';
import React, { useEffect, useState } from 'react';
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
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { useSpecialEducationProgress } from '../../../shared/SpecialEducationProgress';

const DEFAULT_TTS_RATE = 0.6;

interface Game5CelebrationProps {
  onBack: () => void;
  onComplete: () => void;
  section: number;
  level: number;
}

type ChallengeType = 'intro' | 'choice' | 'trace' | 'sorter';

export function Game5Celebration({ onBack, onComplete, section, level }: Game5CelebrationProps) {
  const { width: screenWidth } = useWindowDimensions();
  const { markGameComplete } = useSpecialEducationProgress();
  const [currentChallenge, setCurrentChallenge] = useState<ChallengeType>('intro');
  const [score, setScore] = useState(0);
  const [round, setRound] = useState(1);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const TOTAL_ROUNDS = 4; // One from each previous game type

  const celebrationScale = useSharedValue(1);
  const sparkleOpacity = useSharedValue(0);

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
    const challenges: ChallengeType[] = ['intro', 'choice', 'trace', 'sorter'];
    setCurrentChallenge(challenges[round - 1] || 'intro');
    
    const prompts = [
      'What is the letter A?',
      'Find the letter A',
      'Trace the letter A',
      'Is A a letter or number?',
    ];
    
    const timer = setTimeout(() => {
      speak(prompts[round - 1] || prompts[0]);
    }, 500);
    return () => clearTimeout(timer);
  }, [round]);

  const handleAnswer = (correct: boolean) => {
    if (correct) {
      setScore(score + 1);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      celebrationScale.value = withSpring(1.2, { damping: 6 }, () => {
        celebrationScale.value = withSpring(1);
      });
      speak('Excellent!');
    } else {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      speak('Good try!');
    }

    setTimeout(() => {
      if (round < TOTAL_ROUNDS) {
        setRound(round + 1);
      } else {
        handleComplete();
      }
    }, 2000);
  };

  const handleComplete = async () => {
    const accuracy = Math.round((score / TOTAL_ROUNDS) * 100);
    sparkleOpacity.value = withTiming(1, { duration: 500 });
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    
    try {
      await markGameComplete(section, level, 5, accuracy);
    } catch (error) {
      console.error('Failed to save progress:', error);
    }
    
    speak('Congratulations! You completed Level 1!');
    
    setTimeout(() => {
      onComplete();
    }, 3000);
  };

  const celebrationAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: celebrationScale.value }],
  }));

  const sparkleAnimatedStyle = useAnimatedStyle(() => ({
    opacity: sparkleOpacity.value,
  }));

  const renderChallenge = () => {
    switch (currentChallenge) {
      case 'intro':
        return (
          <View style={styles.challengeContainer}>
            <Text style={styles.challengeQuestion}>What is the letter A?</Text>
            <View style={styles.optionsRow}>
              <TouchableOpacity
                style={styles.optionButton}
                onPress={() => handleAnswer(true)}
                activeOpacity={0.8}
              >
                <Text style={styles.optionButtonText}>A</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.optionButton}
                onPress={() => handleAnswer(false)}
                activeOpacity={0.8}
              >
                <Text style={styles.optionButtonText}>B</Text>
              </TouchableOpacity>
            </View>
          </View>
        );
      case 'choice':
        return (
          <View style={styles.challengeContainer}>
            <Text style={styles.challengeQuestion}>Find the letter A</Text>
            <View style={styles.optionsGrid}>
              {['A', 'B', 'C'].map((letter, index) => (
                <TouchableOpacity
                  key={index}
                  style={styles.optionCard}
                  onPress={() => handleAnswer(letter === 'A')}
                  activeOpacity={0.8}
                >
                  <Text style={styles.optionCardText}>{letter}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        );
      case 'trace':
        return (
          <View style={styles.challengeContainer}>
            <Text style={styles.challengeQuestion}>Trace the letter A</Text>
            <View style={styles.tracePreview}>
              <Text style={styles.tracePreviewText}>A</Text>
            </View>
            <TouchableOpacity
              style={styles.completeButton}
              onPress={() => handleAnswer(true)}
              activeOpacity={0.8}
            >
              <Text style={styles.completeButtonText}>I traced it!</Text>
            </TouchableOpacity>
          </View>
        );
      case 'sorter':
        return (
          <View style={styles.challengeContainer}>
            <Text style={styles.challengeQuestion}>Is A a letter or number?</Text>
            <View style={styles.optionsRow}>
              <TouchableOpacity
                style={[styles.optionButton, styles.optionButtonLetter]}
                onPress={() => handleAnswer(true)}
                activeOpacity={0.8}
              >
                <Text style={styles.optionButtonText}>Letter</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.optionButton, styles.optionButtonNumber]}
                onPress={() => handleAnswer(false)}
                activeOpacity={0.8}
              >
                <Text style={styles.optionButtonText}>Number</Text>
              </TouchableOpacity>
            </View>
          </View>
        );
      default:
        return null;
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color="#0F172A" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Game 5: The Celebration</Text>
        <View style={styles.scoreContainer}>
          <Text style={styles.scoreText}>{score}/{TOTAL_ROUNDS}</Text>
        </View>
      </View>

      <View style={styles.content}>
        <View style={styles.titleContainer}>
          <Animated.View style={celebrationAnimatedStyle}>
            <Text style={styles.titleEmoji}>🎉</Text>
          </Animated.View>
          <Text style={styles.titleText}>Boss Level!</Text>
          <Text style={styles.subtitleText}>Review everything you learned</Text>
        </View>

        {renderChallenge()}

        {isSpeaking && (
          <View style={styles.speakingIndicator}>
            <ActivityIndicator size="small" color="#EC4899" />
            <Text style={styles.speakingText}>Speaking...</Text>
          </View>
        )}

        {round === TOTAL_ROUNDS && (
          <Animated.View style={[styles.celebrationOverlay, sparkleAnimatedStyle]}>
            <Text style={styles.celebrationEmoji}>✨</Text>
            <Text style={styles.celebrationText}>Level Complete!</Text>
          </Animated.View>
        )}
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
    flex: 1,
    textAlign: 'center',
  },
  scoreContainer: {
    width: 40,
    alignItems: 'flex-end',
  },
  scoreText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#EC4899',
  },
  content: {
    flex: 1,
    padding: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  titleContainer: {
    alignItems: 'center',
    marginBottom: 32,
  },
  titleEmoji: {
    fontSize: 64,
    marginBottom: 8,
  },
  titleText: {
    fontSize: 32,
    fontWeight: '900',
    color: '#EC4899',
    marginBottom: 4,
  },
  subtitleText: {
    fontSize: 16,
    color: '#64748B',
    fontWeight: '600',
  },
  challengeContainer: {
    width: '100%',
    alignItems: 'center',
  },
  challengeQuestion: {
    fontSize: 24,
    fontWeight: '800',
    color: '#0F172A',
    textAlign: 'center',
    marginBottom: 32,
  },
  optionsRow: {
    flexDirection: 'row',
    gap: 16,
    width: '100%',
    justifyContent: 'center',
  },
  optionsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 16,
    justifyContent: 'center',
    width: '100%',
  },
  optionButton: {
    flex: 1,
    backgroundColor: '#FFF',
    padding: 24,
    borderRadius: 16,
    borderWidth: 3,
    borderColor: '#E2E8F0',
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 120,
  },
  optionButtonLetter: {
    borderColor: '#3B82F6',
  },
  optionButtonNumber: {
    borderColor: '#10B981',
  },
  optionButtonText: {
    fontSize: 20,
    fontWeight: '800',
    color: '#0F172A',
  },
  optionCard: {
    width: 100,
    height: 100,
    backgroundColor: '#FFF',
    borderRadius: 16,
    borderWidth: 3,
    borderColor: '#3B82F6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  optionCardText: {
    fontSize: 48,
    fontWeight: '900',
    color: '#3B82F6',
  },
  tracePreview: {
    width: 200,
    height: 200,
    backgroundColor: '#FFF',
    borderRadius: 20,
    borderWidth: 4,
    borderColor: '#3B82F6',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
  },
  tracePreviewText: {
    fontSize: 120,
    fontWeight: '900',
    color: '#3B82F6',
  },
  completeButton: {
    backgroundColor: '#EC4899',
    paddingHorizontal: 32,
    paddingVertical: 16,
    borderRadius: 16,
  },
  completeButtonText: {
    fontSize: 18,
    fontWeight: '800',
    color: '#FFF',
  },
  speakingIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 24,
  },
  speakingText: {
    fontSize: 14,
    color: '#64748B',
    fontWeight: '600',
  },
  celebrationOverlay: {
    position: 'absolute',
    top: '50%',
    alignItems: 'center',
  },
  celebrationEmoji: {
    fontSize: 64,
    marginBottom: 16,
  },
  celebrationText: {
    fontSize: 32,
    fontWeight: '900',
    color: '#EC4899',
  },
});


