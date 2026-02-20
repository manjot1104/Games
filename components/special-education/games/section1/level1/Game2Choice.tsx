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
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { useSpecialEducationProgress } from '../../../shared/SpecialEducationProgress';

const DEFAULT_TTS_RATE = 0.6;

interface Game2ChoiceProps {
  onBack: () => void;
  onComplete: () => void;
  section: number;
  level: number;
}

type QuestionType = 'letter' | 'number';
type Option = { value: string; isCorrect: boolean; type: QuestionType };

export function Game2Choice({ onBack, onComplete, section, level }: Game2ChoiceProps) {
  const { width: screenWidth } = useWindowDimensions();
  const { markGameComplete } = useSpecialEducationProgress();
  const [currentQuestion, setCurrentQuestion] = useState<QuestionType>('letter');
  const [score, setScore] = useState(0);
  const [round, setRound] = useState(1);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [selectedOption, setSelectedOption] = useState<string | null>(null);
  const [showFeedback, setShowFeedback] = useState(false);
  const [isCorrect, setIsCorrect] = useState(false);
  const TOTAL_ROUNDS = 4; // 2 letter questions, 2 number questions

  const scaleAnim = useSharedValue(1);

  // Questions for Level 1: Letter A and Number 1
  const questions: Array<{ type: QuestionType; correct: string; prompt: string; options: Option[] }> = [
    {
      type: 'letter',
      correct: 'A',
      prompt: 'Find the letter A',
      options: [
        { value: 'A', isCorrect: true, type: 'letter' },
        { value: 'B', isCorrect: false, type: 'letter' },
        { value: 'C', isCorrect: false, type: 'letter' },
      ],
    },
    {
      type: 'letter',
      correct: 'A',
      prompt: 'Touch the letter A',
      options: [
        { value: 'D', isCorrect: false, type: 'letter' },
        { value: 'A', isCorrect: true, type: 'letter' },
        { value: 'E', isCorrect: false, type: 'letter' },
      ],
    },
    {
      type: 'number',
      correct: '1',
      prompt: 'Find the number 1',
      options: [
        { value: '1', isCorrect: true, type: 'number' },
        { value: '2', isCorrect: false, type: 'number' },
        { value: '3', isCorrect: false, type: 'number' },
      ],
    },
    {
      type: 'number',
      correct: '1',
      prompt: 'Touch the number 1',
      options: [
        { value: '4', isCorrect: false, type: 'number' },
        { value: '1', isCorrect: true, type: 'number' },
        { value: '5', isCorrect: false, type: 'number' },
      ],
    },
  ];

  const currentQuestionData = questions[round - 1];

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
    // Speak the question when round changes
    const timer = setTimeout(() => {
      speak(currentQuestionData.prompt);
    }, 500);
    return () => clearTimeout(timer);
  }, [round]);

  const handleOptionSelect = (option: Option) => {
    if (selectedOption) return; // Prevent multiple selections

    setSelectedOption(option.value);
    const correct = option.isCorrect;
    setIsCorrect(correct);
    setShowFeedback(true);

    if (correct) {
      setScore(score + 1);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      scaleAnim.value = withSpring(1.2, { damping: 6 }, () => {
        scaleAnim.value = withSpring(1);
      });
      speak('Great job!');
    } else {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      speak('Try again');
    }

    // Move to next round after delay
    setTimeout(() => {
      if (round < TOTAL_ROUNDS) {
        setRound(round + 1);
        setSelectedOption(null);
        setShowFeedback(false);
      } else {
        // Game complete
        handleComplete();
      }
    }, 2000);
  };

  const handleComplete = async () => {
    const accuracy = Math.round((score / TOTAL_ROUNDS) * 100);
    try {
      await markGameComplete(section, level, 2, accuracy);
    } catch (error) {
      console.error('Failed to save progress:', error);
    }
    setTimeout(() => {
      onComplete();
    }, 1500);
  };

  const optionAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scaleAnim.value }],
  }));

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color="#0F172A" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Game 2: The Choice</Text>
        <View style={styles.scoreContainer}>
          <Text style={styles.scoreText}>{score}/{TOTAL_ROUNDS}</Text>
        </View>
      </View>

      <View style={styles.content}>
        <View style={styles.questionContainer}>
          <Text style={styles.questionText}>{currentQuestionData.prompt}</Text>
          {isSpeaking && (
            <View style={styles.speakingIndicator}>
              <ActivityIndicator size="small" color="#3B82F6" />
            </View>
          )}
        </View>

        <View style={styles.optionsContainer}>
          {currentQuestionData.options.map((option, index) => {
            const isSelected = selectedOption === option.value;
            const showCorrect = showFeedback && option.isCorrect;
            const showIncorrect = showFeedback && isSelected && !option.isCorrect;

            return (
              <TouchableOpacity
                key={index}
                style={[
                  styles.optionCard,
                  isSelected && styles.optionCardSelected,
                  showCorrect && styles.optionCardCorrect,
                  showIncorrect && styles.optionCardIncorrect,
                ]}
                onPress={() => handleOptionSelect(option)}
                disabled={!!selectedOption}
                activeOpacity={0.8}
              >
                <Animated.View style={[styles.optionContent, optionAnimatedStyle]}>
                  <Text
                    style={[
                      styles.optionText,
                      option.type === 'letter' && styles.optionLetter,
                      option.type === 'number' && styles.optionNumber,
                    ]}
                  >
                    {option.value}
                  </Text>
                </Animated.View>
                {showCorrect && (
                  <View style={styles.feedbackIcon}>
                    <Ionicons name="checkmark-circle" size={32} color="#10B981" />
                  </View>
                )}
                {showIncorrect && (
                  <View style={styles.feedbackIcon}>
                    <Ionicons name="close-circle" size={32} color="#EF4444" />
                  </View>
                )}
              </TouchableOpacity>
            );
          })}
        </View>

        {round === TOTAL_ROUNDS && showFeedback && (
          <View style={styles.completionContainer}>
            <Text style={styles.completionText}>Great job! 🎉</Text>
          </View>
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
    color: '#3B82F6',
  },
  content: {
    flex: 1,
    padding: 24,
    justifyContent: 'center',
  },
  questionContainer: {
    alignItems: 'center',
    marginBottom: 48,
  },
  questionText: {
    fontSize: 28,
    fontWeight: '800',
    color: '#0F172A',
    textAlign: 'center',
    marginBottom: 8,
  },
  speakingIndicator: {
    marginTop: 8,
  },
  optionsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 16,
  },
  optionCard: {
    width: 120,
    height: 120,
    backgroundColor: '#FFF',
    borderRadius: 20,
    borderWidth: 3,
    borderColor: '#E2E8F0',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
    position: 'relative',
  },
  optionCardSelected: {
    borderColor: '#3B82F6',
  },
  optionCardCorrect: {
    borderColor: '#10B981',
    backgroundColor: '#F0FDF4',
  },
  optionCardIncorrect: {
    borderColor: '#EF4444',
    backgroundColor: '#FEF2F2',
  },
  optionContent: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  optionText: {
    fontSize: 48,
    fontWeight: '900',
  },
  optionLetter: {
    color: '#3B82F6',
  },
  optionNumber: {
    color: '#10B981',
  },
  feedbackIcon: {
    position: 'absolute',
    top: -8,
    right: -8,
  },
  completionContainer: {
    alignItems: 'center',
    marginTop: 32,
  },
  completionText: {
    fontSize: 24,
    fontWeight: '800',
    color: '#10B981',
  },
});


