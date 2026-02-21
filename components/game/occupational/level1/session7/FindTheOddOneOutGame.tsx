import CongratulationsScreen from '@/components/game/CongratulationsScreen';
import { logGameAndAward, recordGame } from '@/utils/api';
import { cleanupSounds, stopAllSpeech } from '@/utils/soundPlayer';
import { Audio as ExpoAudio } from 'expo-av';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { speak as speakTTS, DEFAULT_TTS_RATE, stopTTS } from '@/utils/tts';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
    Animated,
    Easing,
    Platform,
    Pressable,
    SafeAreaView,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';

const SUCCESS_SOUND = 'https://actions.google.com/sounds/v1/cartoon/balloon_pop.ogg';
const ERROR_SOUND = 'https://actions.google.com/sounds/v1/cartoon/wood_plank_flicks.ogg';
const TOTAL_ROUNDS = 8;
const ITEM_SIZE = 100;

type ItemType = 'circle' | 'square' | 'triangle' | 'star';

const ITEM_EMOJIS: Record<ItemType, string> = {
  circle: '⭕',
  square: '⬜',
  triangle: '▲',
  star: '⭐',
};

const useSoundEffect = (uri: string) => {
  const soundRef = useRef<ExpoAudio.Sound | null>(null);

  const ensureSound = useCallback(async () => {
    if (soundRef.current) return;
    try {
      const { sound } = await ExpoAudio.Sound.createAsync(
        { uri },
        { volume: 0.6, shouldPlay: false },
      );
      soundRef.current = sound;
    } catch {
      console.warn('Failed to load sound:', uri);
    }
  }, [uri]);

  useEffect(() => {
    return () => {
      soundRef.current?.unloadAsync().catch(() => {});
    };
  }, []);

  const play = useCallback(async () => {
    try {
      if (Platform.OS === 'web') return;
      await ensureSound();
      if (soundRef.current) await soundRef.current.replayAsync();
    } catch {}
  }, [ensureSound]);

  return play;
};

const FindTheOddOneOutGame: React.FC<{ onBack?: () => void }> = ({ onBack }) => {
  const router = useRouter();

  const [round, setRound] = useState(1);
  const [score, setScore] = useState(0);
  const [done, setDone] = useState(false);
  const [finalStats, setFinalStats] = useState<{ correct: number; total: number; xp: number } | null>(null);
  const [logTimestamp, setLogTimestamp] = useState<string | null>(null);
  const [showCongratulations, setShowCongratulations] = useState(false);
  const [roundActive, setRoundActive] = useState(false);
  const [items, setItems] = useState<Array<{ type: ItemType; isOdd: boolean; scale: Animated.Value; shakeAnim: Animated.Value }>>([]);
  const [isShaking, setIsShaking] = useState(false);

  const playSuccess = useSoundEffect(SUCCESS_SOUND);
  const playError = useSoundEffect(ERROR_SOUND);

  const COLORS = ['#3B82F6', '#22C55E', '#F59E0B', '#EF4444', '#8B5CF6', '#F472B6'];

  // End game function
  const endGame = useCallback(
    async (finalScore: number) => {
      const total = TOTAL_ROUNDS;
      const xp = finalScore * 15; // 15 XP per correct tap
      const accuracy = (finalScore / total) * 100;

      // Set all states together FIRST (like CatchTheBouncingStar)
      setFinalStats({ correct: finalScore, total, xp });
      setDone(true);
      setRoundActive(false);
      setShowCongratulations(true);
      
      speakTTS('Amazing work! You completed the game!', 0.78);

      // Log game in background (don't wait for it)
      try {
        await recordGame(xp);
        const result = await logGameAndAward({
          type: 'findTheOddOneOut' as any,
          correct: finalScore,
          total,
          accuracy,
          xpAwarded: xp,
          skillTags: ['figure-ground-perception', 'discrimination', 'early-classification'],
        });
        setLogTimestamp(result?.last?.at ?? null);
        router.setParams({ refreshStats: Date.now().toString() });
      } catch (e) {
        console.error('Failed to log find the odd one out game:', e);
      }
    },
    [router],
  );

  // Start a new round
  const startRound = useCallback(() => {
    // Generate 3 items of one type + 1 item of another
    const allTypes: ItemType[] = ['circle', 'square', 'triangle', 'star'];
    const commonType = allTypes[Math.floor(Math.random() * allTypes.length)];
    const oddType = allTypes.filter(t => t !== commonType)[Math.floor(Math.random() * (allTypes.length - 1))];

    // Create 4 items: 3 common + 1 odd
    const newItems: Array<{ type: ItemType; isOdd: boolean; scale: Animated.Value; shakeAnim: Animated.Value }> = [
      { type: commonType, isOdd: false, scale: new Animated.Value(1), shakeAnim: new Animated.Value(0) },
      { type: commonType, isOdd: false, scale: new Animated.Value(1), shakeAnim: new Animated.Value(0) },
      { type: commonType, isOdd: false, scale: new Animated.Value(1), shakeAnim: new Animated.Value(0) },
      { type: oddType, isOdd: true, scale: new Animated.Value(1), shakeAnim: new Animated.Value(0) },
    ];

    // Shuffle items
    const shuffled = newItems.sort(() => Math.random() - 0.5);
    setItems(shuffled);
    setRoundActive(true);
    setIsShaking(false);
  }, []);

  // Handle item tap
  const handleItemTap = useCallback(
    async (index: number) => {
      if (!roundActive || done || isShaking) return;

      const item = items[index];
      if (!item) return;

      const isCorrect = item.isOdd;

      if (isCorrect) {
        // Correct tap - success animation
        setRoundActive(false);
        Animated.sequence([
          Animated.timing(item.scale, {
            toValue: 1.3,
            duration: 120,
            easing: Easing.out(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(item.scale, {
            toValue: 0,
            duration: 150,
            easing: Easing.in(Easing.ease),
            useNativeDriver: true,
          }),
        ]).start();

        try {
          await playSuccess();
          await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        } catch {}

        setScore((s) => s + 1);

        // Next round or finish
        if (round >= TOTAL_ROUNDS) {
          endGame(score + 1);
        } else {
          setTimeout(() => {
            setRound((r) => r + 1);
            setTimeout(() => {
              startRound();
            }, 400);
          }, 600);
        }
      } else {
        // Wrong tap - shake animation
        setIsShaking(true);
        Animated.sequence([
          Animated.timing(item.shakeAnim, {
            toValue: 10,
            duration: 50,
            easing: Easing.out(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(item.shakeAnim, {
            toValue: -10,
            duration: 50,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(item.shakeAnim, {
            toValue: 10,
            duration: 50,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(item.shakeAnim, {
            toValue: 0,
            duration: 50,
            easing: Easing.out(Easing.ease),
            useNativeDriver: true,
          }),
        ]).start(() => {
          setIsShaking(false);
        });

        try {
          await playError();
          await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
          speakTTS('Find the different one!', 0.78 );
        } catch {}

        // Retry - don't advance round
      }
    },
    [roundActive, done, isShaking, items, round, score, startRound, endGame, playSuccess, playError],
  );

  // Start first round
  useEffect(() => {
    if (!done) {
      startRound();
    }
  }, []);

  useEffect(() => {
    if (!done) {
      try {
        speakTTS('Find the one that is different!', 0.78 );
      } catch {}
    }
    return () => {
      stopAllSpeech();
      cleanupSounds();
    };
  }, []);

  const handleBack = useCallback(() => {
    stopAllSpeech();
    cleanupSounds();
    onBack?.();
  }, [onBack]);

  // ---------- Congratulations screen FIRST (like CatchTheBouncingStar) ----------
  // This is the ONLY completion screen - no ResultCard needed for OT games
  if (showCongratulations && done && finalStats) {
    return (
      <CongratulationsScreen
        message="Pattern Expert!"
        showButtons={true}
        onContinue={() => {
          // Continue - go back to games (no ResultCard screen needed)
          stopAllSpeech();
          cleanupSounds();
          onBack?.();
        }}
        onHome={() => {
          stopAllSpeech();
          cleanupSounds();
          onBack?.();
        }}
      />
    );
  }

  // Prevent any rendering when game is done but congratulations hasn't shown yet
  if (done && finalStats && !showCongratulations) {
    return null; // Wait for showCongratulations to be set
  }

  return (
    <SafeAreaView style={styles.container}>
      <TouchableOpacity onPress={handleBack} style={styles.backChip}>
        <Text style={styles.backChipText}>← Back</Text>
      </TouchableOpacity>

      <View style={styles.headerBlock}>
        <Text style={styles.title}>Find The Odd One Out</Text>
        <Text style={styles.subtitle}>
          Round {round}/{TOTAL_ROUNDS} • 🔍 Score: {score}
        </Text>
        <Text style={styles.helper}>
          Find the one that's different!
        </Text>
      </View>

      <View style={styles.playArea}>
        <View style={styles.itemsContainer}>
          {items.map((item, index) => {
            const shakeTranslateX = item.shakeAnim.interpolate({
              inputRange: [-10, 10],
              outputRange: [-10, 10],
            });

            return (
              <Animated.View
                key={index}
                style={[
                  styles.itemContainer,
                  {
                    transform: [
                      { scale: item.scale },
                      { translateX: shakeTranslateX },
                    ],
                  },
                ]}
              >
                <Pressable
                  onPress={() => handleItemTap(index)}
                  style={[
                    styles.item,
                    {
                      backgroundColor: item.isOdd ? '#EF4444' : '#3B82F6',
                      borderColor: item.isOdd ? '#DC2626' : '#2563EB',
                      borderWidth: item.isOdd ? 4 : 2,
                    },
                  ]}
                  disabled={!roundActive || done || isShaking}
                >
                  <Text style={styles.itemEmoji}>{ITEM_EMOJIS[item.type]}</Text>
                </Pressable>
              </Animated.View>
            );
          })}
        </View>
      </View>

      <View style={styles.footerBox}>
        <Text style={styles.footerMain}>
          Skills: figure–ground perception • discrimination • early classification
        </Text>
        <Text style={styles.footerSub}>
          Find the item that's different from the others! This builds pattern recognition and classification.
        </Text>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F0F9FF',
    paddingHorizontal: 16,
    paddingTop: 48,
  },
  backChip: {
    position: 'absolute',
    top: 50,
    left: 16,
    zIndex: 10,
    backgroundColor: '#0F172A',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
  },
  backChipText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 14,
  },
  headerBlock: {
    marginTop: 72,
    marginBottom: 16,
    alignItems: 'center',
  },
  title: {
    fontSize: 24,
    fontWeight: '800',
    color: '#0F172A',
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 16,
    color: '#0F172A',
    marginBottom: 6,
  },
  helper: {
    fontSize: 14,
    color: '#475569',
    textAlign: 'center',
    paddingHorizontal: 18,
  },
  playArea: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  itemsContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 15,
    flexWrap: 'wrap',
  },
  itemContainer: {
    margin: 8,
  },
  item: {
    width: ITEM_SIZE,
    height: ITEM_SIZE,
    borderRadius: ITEM_SIZE / 2,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 5 },
    elevation: 8,
  },
  itemEmoji: {
    fontSize: 50,
  },
  footerBox: {
    paddingVertical: 14,
    marginBottom: 20,
  },
  footerMain: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0F172A',
    textAlign: 'center',
    marginBottom: 4,
  },
  footerSub: {
    fontSize: 13,
    color: '#64748B',
    textAlign: 'center',
  },
  resultCard: {
    width: '100%',
    maxWidth: 420,
    borderRadius: 24,
    backgroundColor: '#fff',
    padding: 24,
    alignItems: 'center',
    marginTop: 16,
  },
  resultTitle: {
    fontSize: 28,
    fontWeight: '800',
    color: '#0F172A',
    marginBottom: 8,
  },
  resultSubtitle: {
    fontSize: 16,
    color: '#64748B',
    textAlign: 'center',
    marginBottom: 20,
  },
  savedText: {
    marginTop: 16,
    fontSize: 14,
    color: '#22C55E',
    fontWeight: '600',
  },
});

export default FindTheOddOneOutGame;

