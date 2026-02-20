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
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { useSpecialEducationProgress } from '../../../shared/SpecialEducationProgress';

const DEFAULT_TTS_RATE = 0.6;

interface Game4SorterProps {
  onBack: () => void;
  onComplete: () => void;
  section: number;
  level: number;
}

type Item = { value: string; type: 'letter' | 'number'; id: string };

export function Game4Sorter({ onBack, onComplete, section, level }: Game4SorterProps) {
  const { width: screenWidth } = useWindowDimensions();
  const { markGameComplete } = useSpecialEducationProgress();
  const [items, setItems] = useState<Item[]>([
    { value: 'A', type: 'letter', id: '1' },
    { value: '1', type: 'number', id: '2' },
    { value: 'B', type: 'letter', id: '3' },
    { value: '2', type: 'number', id: '4' },
    { value: 'A', type: 'letter', id: '5' },
    { value: '1', type: 'number', id: '6' },
  ]);
  const [letterBucket, setLetterBucket] = useState<Item[]>([]);
  const [numberBucket, setNumberBucket] = useState<Item[]>([]);
  const [selectedItem, setSelectedItem] = useState<Item | null>(null);
  const [round, setRound] = useState(1);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const TOTAL_ROUNDS = 3;

  const scaleAnim = useSharedValue(1);

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
    const prompts = [
      'Put letters in the blue bucket and numbers in the green bucket',
      'Sort the letters and numbers',
      'Drag letters to blue, numbers to green',
    ];
    const timer = setTimeout(() => {
      speak(prompts[round - 1] || prompts[0]);
    }, 500);
    return () => clearTimeout(timer);
  }, [round]);

  const handleItemSelect = (item: Item) => {
    if (selectedItem?.id === item.id) {
      setSelectedItem(null);
    } else {
      setSelectedItem(item);
    }
  };

  const handleBucketDrop = (bucketType: 'letter' | 'number') => {
    if (!selectedItem) return;

    const isCorrect = selectedItem.type === bucketType;
    
    if (isCorrect) {
      // Remove from items
      setItems(items.filter((i) => i.id !== selectedItem.id));
      
      // Add to correct bucket
      if (bucketType === 'letter') {
        setLetterBucket([...letterBucket, selectedItem]);
      } else {
        setNumberBucket([...numberBucket, selectedItem]);
      }
      
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      scaleAnim.value = withSpring(1.2, { damping: 6 }, () => {
        scaleAnim.value = withSpring(1);
      });
      speak('Great job!');
    } else {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      speak('Try again');
    }

    setSelectedItem(null);

    // Check if all items sorted
    if (items.length === 1) {
      // All sorted, move to next round or complete
      if (round < TOTAL_ROUNDS) {
        setTimeout(() => {
          // Reset for next round
          setItems([
            { value: 'A', type: 'letter', id: '1' },
            { value: '1', type: 'number', id: '2' },
            { value: 'C', type: 'letter', id: '3' },
            { value: '3', type: 'number', id: '4' },
          ]);
          setLetterBucket([]);
          setNumberBucket([]);
          setRound(round + 1);
        }, 2000);
      } else {
        handleComplete();
      }
    }
  };

  const handleComplete = async () => {
    const accuracy = 100; // Perfect if all sorted correctly
    try {
      await markGameComplete(section, level, 4, accuracy);
    } catch (error) {
      console.error('Failed to save progress:', error);
    }
    setTimeout(() => {
      onComplete();
    }, 1500);
  };

  const bucketAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scaleAnim.value }],
  }));

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color="#0F172A" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Game 4: The Sorter</Text>
        <View style={styles.roundContainer}>
          <Text style={styles.roundText}>Round {round}/{TOTAL_ROUNDS}</Text>
        </View>
      </View>

      <View style={styles.content}>
        <View style={styles.instructionContainer}>
          <Text style={styles.instructionText}>
            Sort letters and numbers into the correct buckets
          </Text>
          {isSpeaking && (
            <View style={styles.speakingIndicator}>
              <ActivityIndicator size="small" color="#3B82F6" />
            </View>
          )}
        </View>

        <View style={styles.itemsContainer}>
          {items.map((item) => (
            <TouchableOpacity
              key={item.id}
              style={[
                styles.itemCard,
                selectedItem?.id === item.id && styles.itemCardSelected,
                item.type === 'letter' && styles.itemCardLetter,
                item.type === 'number' && styles.itemCardNumber,
              ]}
              onPress={() => handleItemSelect(item)}
              activeOpacity={0.8}
            >
              <Text
                style={[
                  styles.itemText,
                  item.type === 'letter' && styles.itemTextLetter,
                  item.type === 'number' && styles.itemTextNumber,
                ]}
              >
                {item.value}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <View style={styles.bucketsContainer}>
          <Animated.View style={[styles.bucket, bucketAnimatedStyle]}>
            <TouchableOpacity
              style={[styles.bucketContent, styles.bucketLetter]}
              onPress={() => handleBucketDrop('letter')}
              activeOpacity={0.8}
            >
              <Ionicons name="cube" size={32} color="#3B82F6" />
              <Text style={styles.bucketLabel}>Letters</Text>
              <Text style={styles.bucketCount}>{letterBucket.length}</Text>
            </TouchableOpacity>
          </Animated.View>

          <Animated.View style={[styles.bucket, bucketAnimatedStyle]}>
            <TouchableOpacity
              style={[styles.bucketContent, styles.bucketNumber]}
              onPress={() => handleBucketDrop('number')}
              activeOpacity={0.8}
            >
              <Ionicons name="cube" size={32} color="#10B981" />
              <Text style={styles.bucketLabel}>Numbers</Text>
              <Text style={styles.bucketCount}>{numberBucket.length}</Text>
            </TouchableOpacity>
          </Animated.View>
        </View>

        {selectedItem && (
          <View style={styles.hintContainer}>
            <Text style={styles.hintText}>
              Tap the {selectedItem.type === 'letter' ? 'blue' : 'green'} bucket to drop
            </Text>
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
  roundContainer: {
    width: 40,
    alignItems: 'flex-end',
  },
  roundText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#64748B',
  },
  content: {
    flex: 1,
    padding: 24,
  },
  instructionContainer: {
    alignItems: 'center',
    marginBottom: 24,
  },
  instructionText: {
    fontSize: 20,
    fontWeight: '700',
    color: '#0F172A',
    textAlign: 'center',
    marginBottom: 8,
  },
  speakingIndicator: {
    marginTop: 8,
  },
  itemsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 12,
    marginBottom: 32,
  },
  itemCard: {
    width: 80,
    height: 80,
    backgroundColor: '#FFF',
    borderRadius: 16,
    borderWidth: 3,
    borderColor: '#E2E8F0',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  itemCardSelected: {
    borderWidth: 4,
    transform: [{ scale: 1.1 }],
  },
  itemCardLetter: {
    borderColor: '#3B82F6',
  },
  itemCardNumber: {
    borderColor: '#10B981',
  },
  itemText: {
    fontSize: 36,
    fontWeight: '900',
  },
  itemTextLetter: {
    color: '#3B82F6',
  },
  itemTextNumber: {
    color: '#10B981',
  },
  bucketsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    gap: 16,
  },
  bucket: {
    flex: 1,
  },
  bucketContent: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    borderRadius: 20,
    borderWidth: 3,
    minHeight: 150,
  },
  bucketLetter: {
    backgroundColor: '#EFF6FF',
    borderColor: '#3B82F6',
  },
  bucketNumber: {
    backgroundColor: '#F0FDF4',
    borderColor: '#10B981',
  },
  bucketLabel: {
    fontSize: 18,
    fontWeight: '800',
    marginTop: 8,
  },
  bucketCount: {
    fontSize: 24,
    fontWeight: '900',
    marginTop: 4,
  },
  hintContainer: {
    marginTop: 24,
    padding: 16,
    backgroundColor: '#FEF3C7',
    borderRadius: 12,
    alignItems: 'center',
  },
  hintText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#F59E0B',
  },
});


