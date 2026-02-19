// Games.tsx — AAC-friendly games (Tap Timing + Picture Match + Quick Sort + Find Emoji)
// Includes guards for undefined items in FlatList and no conditional/top-level hook misuse.

import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { speak as speakTTS, speakSequence, clearScheduledSpeech, DEFAULT_TTS_RATE } from '@/utils/tts';
import { FlatList, Image, SafeAreaView, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Animated, {
    Easing,
    FadeInDown,
    FadeInUp,
    cancelAnimation,
    useAnimatedStyle,
    useSharedValue,
    withRepeat,
    withSpring,
    withTiming
} from 'react-native-reanimated';

import { BigTapTarget } from '@/components/game/occupational/level1/session1/BigTapTarget';
import { ResultToast, SparkleBurst, Stepper } from '@/components/game/FX';
import BalloonPopGame from '@/components/game/occupational/level1/session1/MovingTargetTapGame';
import MultiTapFunGame from '@/components/game/occupational/level1/session1/MultiTapFunGame';
import ResultCard from '@/components/game/ResultCard';
import TapAndHoldGame from '@/components/game/occupational/level1/session1/TapAndHoldGame';
import TapRedCircleGame from '@/components/game/occupational/level1/session1/TapRedCircleGame';
import { CATEGORIES, type Tile, tileImages } from '@/constants/aac';
import { icons } from '@/constants/icons';
import { images } from '@/constants/images';
import { fetchMyStats, finishTapRound, logGameAndAward, recordGame, startTapRound } from '@/utils/api';

// -------------------- Shared UI helpers --------------------
// Small reusable card was unused and removed to avoid an unused symbol lint warning.

function BigButton({
  title,
  color = '#2563EB',
  onPress,
  icon,
}: {
  title: string;
  color?: string;
  onPress: () => void;
  icon?: any;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.92}
      style={{ backgroundColor: color }}
      className="mt-4 px-6 py-4 rounded-2xl flex-row items-center justify-center"
    >
      {icon ? <Image source={icon} style={{ width: 28, height: 28, marginRight: 10 }} /> : null}
      <Text className="text-white font-extrabold text-lg">{title}</Text>
    </TouchableOpacity>
  );
}

// Use shared TTS utility (speech-to-speech on web, expo-speech on native)
// Imported from @/utils/tts
let lastSpokenQuestionId: number | string | null = null;

// Local rate override for this component (slightly slower for kids)
const LOCAL_TTS_RATE = 0.78;

// Wrapper to use local rate
function speak(text: string, rate = LOCAL_TTS_RATE) {
  speakTTS(text, rate);
}

/** Helper to speak a question + options nicely:
 * e.g. question: "What number is this?"
 * options: ["One", "Two", "Three"]
 */
function speakQuestionWithOptions(
  question: string,
  options: string[],
  questionId?: number | string | null,
  rate = LOCAL_TTS_RATE
) {
  if (!question) return;
  if (questionId !== undefined && questionId !== null && lastSpokenQuestionId === questionId) return;
  lastSpokenQuestionId = questionId ?? null;

  // speak the question first, then "Options:" then each option
  const optionTexts = options && options.length
    ? ['Options:', ...options.map((o, idx) => `${idx + 1}. ${o}`)]
    : [];
  speakSequence([question, ...optionTexts], rate, 600); // 600ms gap — comfortable for kids
}

// -------------------- Data pools (safe, kid-friendly) --------------------
type CatId = 'transport' | 'food' | 'animals' | 'emotions' | 'jobs' | 'actions';
function tilesByCat(id: CatId): Tile[] {
  const cat = CATEGORIES.find((c) => c.id === id);
  return cat ? cat.tiles : [];
}
const TRANSPORT = tilesByCat('transport');
const FOOD = tilesByCat('food');
// animals pool intentionally omitted when not used to avoid unused variable warnings
const EMOTIONS = tilesByCat('emotions'); // used by Emoji game
const JOBS = tilesByCat('jobs');
const ACTIONS = tilesByCat('actions');

// Compact pool for picture games (no hooks at module scope)
const PICTURE_POOL: Tile[] = (() => {
  const set = new Map<string, Tile>();
  [...TRANSPORT.slice(0, 12), ...FOOD.slice(0, 12)].forEach((t) => {
    if (t && t.id) set.set(t.id, t);
  });
  return Array.from(set.values());
})();

// -------------------- Game: Tap Timing --------------------
function TapTiming({ onBack }: { onBack: () => void }) {
  const router = useRouter();
  const [roundId, setRoundId] = useState<string | null>(null);
  const [targetSec, setTargetSec] = useState<number | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [state, setState] = useState<'idle' | 'running' | 'done' | 'error'>('idle');
  const [msg, setMsg] = useState<string | null>(null);
  const [summary, setSummary] = useState<{ xp: number; streak: number; games: number } | null>(null);
  const [tapDeltaMs, setTapDeltaMs] = useState<number | null>(null);
  const [logTimestamp, setLogTimestamp] = useState<string | null>(null);

  const startClientAt = useRef<number | null>(null);
  const raf = useRef<number | null>(null);
  const prefetch = useRef<{ roundId: string; targetSeconds: number } | null>(null);
  // removed per-second speech

  // === Accuracy helper based on numeric difference (seconds)
  // - within 1s (<=1.0) => 100%
  // - 1s -> 10s => linear drop 100 -> 0 (span = 9s)
  // - >=10s => 0%
  const calcAccuracyFromSeconds = (diffSec: number) => {
    if (diffSec <= 1) return 100;
    if (diffSec >= 10) return 0;
    const acc = 100 * (1 - (diffSec - 1) / 9); // linear between 1 and 10
    return Math.max(0, Math.min(100, acc));
  };

  const stopTicker = () => {
    if (raf.current != null) cancelAnimationFrame(raf.current);
    raf.current = null;
  };
  const startTicker = () => {
    const t0 = Date.now();
    const tick = () => {
      setElapsedMs(Date.now() - (startClientAt.current ?? t0));
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
  };

  const prefetchRound = useCallback(async () => {
    try {
      const data = await startTapRound();
      prefetch.current = data;
    } catch (e: any) {
      console.log('Prefetch tap round failed', e?.message || e);
      prefetch.current = null;
    }
  }, []);

  useEffect(() => {
    prefetchRound();
  }, [prefetchRound]);

  const onStart = async () => {
    try {
      setState('running');
      setMsg(null);
      setElapsedMs(0);
      let round = prefetch.current;
      if (!round) {
        round = await startTapRound();
      }
      prefetch.current = null;
      setRoundId(round.roundId);
      setTargetSec(round.targetSeconds);
      startClientAt.current = Date.now();
      // reset per-second speech (removed)
      startTicker();
      speak('Wait and tap at the right time!');
      prefetchRound();
    } catch (e: any) {
      setState('error');
      setMsg(e?.message || 'Could not start round');
    }
  };

  const onTap = async () => {
    if (state !== 'running' || !roundId) return;
    stopTicker();
    try {
      const res = await finishTapRound(roundId);

      // === NEW: compute accuracy from the numeric seconds difference (client-side)
      const elapsedSec = elapsedMs / 1000;
      const diffSec = Math.abs(elapsedSec - (targetSec ?? 0));
      const deltaMsFromClient = Math.round(diffSec * 1000);

      // set client-derived tap delta (keeps UI consistent)
      setTapDeltaMs(deltaMsFromClient);

      setState('done');
      setMsg(
        `Target ${res.targetSeconds}s · Yours ${(elapsedMs / 1000).toFixed(1)}s · Δ ${deltaMsFromClient}ms → +${res.pointsAwarded} XP`
      );
      setSummary({
        xp: res.stats.points,
        streak: res.stats.streakDays,
        games: res.stats.totalGamesPlayed,
      });

      // Use numeric-difference-based accuracy
      const accuracy = calcAccuracyFromSeconds(diffSec);
      // isCorrect: within 1s counts as correct
      const isCorrect = diffSec <= 1 ? 1 : 0;

      try {
        const result = await logGameAndAward({
          type: 'tap',
          correct: isCorrect,
          total: 1,
          accuracy: Math.round(accuracy), // store integer percent
          xpAwarded: res.pointsAwarded,
          durationMs: elapsedMs,
          skillTags: ['timing-control'],
        });
        setLogTimestamp(result?.last?.at ?? null);
        // 🔁 tell Home to refetch
        router.setParams({ refreshStats: Date.now().toString() });
      } catch { }
      speak('Great job!');
    } catch (e: any) {
      setState('error');
      setMsg(e?.message || 'Finish failed');
    } finally {
      setRoundId(null);
      setTargetSec(null);
      startClientAt.current = null;
    }
  };

  // Ensure ticker stops on unmount regardless of render branch
  useEffect(() => () => stopTicker(), []);

  // Completion screen
  if (state === 'done' && summary && msg) {
    // Prefer client-derived tapDeltaMs (we no longer rely on server delta for accuracy)
    const deltaMs = tapDeltaMs ?? 0;

    // derive diffSec from client delta for display calculation
    const diffSecForDisplay = Math.abs(deltaMs) / 1000;
    const calculatedAccuracy = calcAccuracyFromSeconds(diffSecForDisplay);
    const accuracy = calculatedAccuracy;

    return (
      <SafeAreaView className="flex-1 bg-white">
        <TouchableOpacity
          onPress={onBack}
          className="absolute top-12 left-6 px-4 py-2 rounded-full z-10"
          style={{
            backgroundColor: '#111827',
            shadowColor: '#000',
            shadowOpacity: 0.2,
            shadowRadius: 8,
            shadowOffset: { width: 0, height: 4 },
            elevation: 6,
          }}
        >
          <Text className="text-white font-semibold">← Back to Games</Text>
        </TouchableOpacity>

        <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', alignItems: 'center', padding: 24 }}>
          <View className="w-full max-w-xl rounded-3xl p-6 bg-white border border-gray-200 items-center mt-16">
            <Text className="text-6xl mb-4">🎯</Text>
            <Text className="text-3xl font-extrabold text-gray-900 mb-2">Game Complete!</Text>
            <Text className="text-xl text-gray-600 mb-4 text-center">
              {msg}
            </Text>

            <ResultCard
              correct={Math.round(accuracy)}
              total={100}
              xpAwarded={summary.xp}
              accuracy={accuracy}
              logTimestamp={logTimestamp}
              onPlayAgain={() => {
                setState('idle');
                setSummary(null);
                setMsg(null);
                setLogTimestamp(null);
                prefetchRound();
              }}
            />

            <Text className="text-green-600 font-semibold text-center mt-4">Saved! XP updated ✅</Text>
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  // per-second speech removed per user feedback

  return (
    <SafeAreaView className="flex-1 items-center justify-center p-6" style={{ backgroundColor: '#F0F9FF' }}>
      <TouchableOpacity
        onPress={onBack}
        className="absolute top-12 left-6 px-4 py-2 rounded-full"
        style={{
          backgroundColor: '#111827',
          shadowColor: '#000',
          shadowOpacity: 0.2,
          shadowRadius: 8,
          shadowOffset: { width: 0, height: 4 },
          elevation: 6,
        }}
      >
        <Text className="text-white font-semibold">← Back to Games</Text>
      </TouchableOpacity>

      <View style={{
        width: '100%',
        maxWidth: 500,
        backgroundColor: '#FFFFFF',
        borderRadius: 32,
        padding: 32,
        shadowColor: '#000',
        shadowOpacity: 0.1,
        shadowRadius: 20,
        shadowOffset: { width: 0, height: 8 },
        elevation: 12,
        borderWidth: 1,
        borderColor: '#E5E7EB',
      }}>
        <View className="items-center mb-6">
          <View style={{
            width: 100,
            height: 100,
            borderRadius: 50,
            backgroundColor: '#6366F1',
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: 16,
            shadowColor: '#6366F1',
            shadowOpacity: 0.3,
            shadowRadius: 16,
            shadowOffset: { width: 0, height: 8 },
            elevation: 8,
          }}>
            <Text style={{ fontSize: 48 }}>🎯</Text>
          </View>
          <Text className="font-extrabold text-3xl text-gray-900 mb-2">Tap Timing</Text>
          <Text className="text-gray-600 text-center text-base">
            Wait for the target time, then tap!
          </Text>
        </View>

        <View className="items-center my-8" style={{
          backgroundColor: '#F8FAFC',
          borderRadius: 24,
          padding: 32,
          borderWidth: 2,
          borderColor: '#E2E8F0',
        }}>
          <Text style={{
            fontSize: 72,
            fontWeight: '900',
            color: state === 'running' ? '#2563EB' : '#1F2937',
            letterSpacing: -2,
          }}>
            {Math.floor(elapsedMs / 1000)}s
          </Text>
          {targetSec != null ? (
            <View style={{
              marginTop: 12,
              backgroundColor: '#FEF3C7',
              paddingHorizontal: 16,
              paddingVertical: 8,
              borderRadius: 16,
            }}>
              <Text style={{
                fontSize: 16,
                fontWeight: '700',
                color: '#92400E',
              }}>
                Target: {targetSec}s
              </Text>
            </View>
          ) : null}
        </View>

        {state !== 'running' ? (
          <BigButton
            title="Start Round"
            color="#16A34A"
            onPress={onStart}
            icon={icons.play}
          />
        ) : (
          <BigButton
            title="TAP NOW!"
            color="#2563EB"
            onPress={onTap}
            icon={images.tapNowIcon}
          />
        )}

        {msg && state !== 'done' ? (
          <View style={{
            marginTop: 16,
            backgroundColor: '#F0F9FF',
            padding: 16,
            borderRadius: 16,
            borderWidth: 1,
            borderColor: '#BFDBFE',
          }}>
            <Text className="text-center text-gray-800 font-semibold">{msg}</Text>
          </View>
        ) : null}

        {summary && state === 'done' ? (
          <View style={{
            marginTop: 16,
            backgroundColor: '#F0FDF4',
            borderRadius: 20,
            padding: 20,
            borderWidth: 1,
            borderColor: '#BBF7D0',
          }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 }}>
              <Text style={{ fontSize: 14, fontWeight: '600', color: '#166534' }}>Total XP:</Text>
              <Text style={{ fontSize: 16, fontWeight: '800', color: '#166534' }}>{summary.xp}</Text>
            </View>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 }}>
              <Text style={{ fontSize: 14, fontWeight: '600', color: '#166534' }}>Streak:</Text>
              <Text style={{ fontSize: 16, fontWeight: '800', color: '#166534' }}>{summary.streak} days 🔥</Text>
            </View>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text style={{ fontSize: 14, fontWeight: '600', color: '#166534' }}>Games:</Text>
              <Text style={{ fontSize: 16, fontWeight: '800', color: '#166534' }}>{summary.games}</Text>
            </View>
          </View>
        ) : null}
      </View>
    </SafeAreaView>
  );
}


// -------------------- Game: Picture Match --------------------
function PictureMatch({ onBack }: { onBack: () => void }) {
  const router = useRouter();
  const [round, setRound] = useState(1);
  const [score, setScore] = useState(0);
  const [target, setTarget] = useState<Tile | null>(null);
  const [choices, setChoices] = useState<Tile[]>([]);
  const [done, setDone] = useState(false);
  const [pmFeedback, setPmFeedback] = useState<null | 'ok' | 'bad'>(null);
  const [fxKey, setFxKey] = useState(0);
  const [locked, setLocked] = useState(false);
  const [finalScore, setFinalScore] = useState<{ correct: number; total: number; xp: number } | null>(null);
  const [logTimestamp, setLogTimestamp] = useState<string | null>(null);
  const pmToastOpacity = useSharedValue(0);
  const pmToastY = useSharedValue(12);

  const pulse = useSharedValue(1);
  const pulseStyle = useScaleStyle(pulse);

  const next = useCallback(() => {
    const pool = PICTURE_POOL;
    if (!pool.length) return;

    const correct = pool[Math.floor(Math.random() * pool.length)];
    const wrongs = pool.filter((t) => t && t.id !== correct.id);
    shuffle(wrongs);
    // Shuffle final options so correct isn't always first
    const opts = shuffle([correct, ...wrongs.slice(0, 2)]).filter(Boolean) as Tile[];

    setTarget(correct);
    setChoices(opts);
    setPmFeedback(null);
    setLocked(false);
    if (correct?.label) speak('Find ' + correct.label);
    pulse.value = 1;
  }, [pulse]);

  useEffect(() => {
    next();
  }, [next]);

  const onPick = async (t: Tile) => {
    if (locked || !target) return; // guard
    setLocked(true);
    const ok = t?.id === target.id;
    animatePulse(pulse, ok);
    if (ok) setScore((s) => s + 1);
    setPmFeedback(ok ? 'ok' : 'bad');
    setFxKey((k) => k + 1);
    pmToastOpacity.value = 0; pmToastY.value = 12;
    pmToastOpacity.value = withTiming(1, { duration: 140 });
    pmToastY.value = withTiming(0, { duration: 140 });

    if (round >= 5) {
      setDone(true);
      const correctCount = score + (ok ? 1 : 0);
      const total = 5;
      const xp = correctCount * 10;
      setFinalScore({ correct: correctCount, total, xp });
      try {
        await recordGame(xp); // legacy XP
        const result = await logGameAndAward({
          type: 'match',
          correct: correctCount,
          total,
          accuracy: (correctCount / total) * 100,
          xpAwarded: xp,
          skillTags: ['color-recognition'],
        });
        setLogTimestamp(result?.last?.at ?? null);
        // 🔁 tell Home to refetch
        router.setParams({ refreshStats: Date.now().toString() });
      } catch { }
      speak('Well done!');
    } else {
      setRound((r) => r + 1);
      setTimeout(() => {
        pmToastOpacity.value = withTiming(0, { duration: 120 });
        next();
      }, 180);
    }
  };

  // Completion screen
  if (done && finalScore) {
    return (
      <SafeAreaView className="flex-1 bg-white">
        <TouchableOpacity
          onPress={onBack}
          className="absolute top-12 left-6 px-4 py-2 rounded-full z-10"
          style={{
            backgroundColor: '#111827',
            shadowColor: '#000',
            shadowOpacity: 0.2,
            shadowRadius: 8,
            shadowOffset: { width: 0, height: 4 },
            elevation: 6,
          }}
        >
          <Text className="text-white font-semibold">← Back to Games</Text>
        </TouchableOpacity>
        <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', alignItems: 'center', padding: 24 }}>
          <View className="w-full max-w-xl rounded-3xl p-6 bg-white border border-gray-200 items-center mt-16">
            <ResultCard
              correct={finalScore.correct}
              total={finalScore.total}
              xpAwarded={finalScore.xp}
              accuracy={(finalScore.correct / finalScore.total) * 100}
              logTimestamp={logTimestamp}
              onPlayAgain={() => {
                setRound(1);
                setScore(0);
                setDone(false);
                setFinalScore(null);
                setPmFeedback(null);
                setLogTimestamp(null);
                next();
              }}
              onHome={() => {
                // Refresh home stats when going back
                router.setParams({ refreshStats: Date.now().toString() });
                onBack();
              }}
            />
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  if (!target || !(choices && choices.length)) return null;

  return (
    <SafeAreaView className="flex-1 items-center justify-center p-6" style={{ backgroundColor: '#F0FDF4' }}>
      <TouchableOpacity
        onPress={onBack}
        className="absolute top-12 left-6 px-4 py-2 rounded-full"
        style={{
          backgroundColor: '#111827',
          shadowColor: '#000',
          shadowOpacity: 0.2,
          shadowRadius: 8,
          shadowOffset: { width: 0, height: 4 },
          elevation: 6,
        }}
      >
        <Text className="text-white font-semibold">← Back to Games</Text>
      </TouchableOpacity>

      <View style={{
        width: '100%',
        maxWidth: 500,
        backgroundColor: '#FFFFFF',
        borderRadius: 32,
        padding: 28,
        shadowColor: '#000',
        shadowOpacity: 0.1,
        shadowRadius: 20,
        shadowOffset: { width: 0, height: 8 },
        elevation: 12,
        borderWidth: 1,
        borderColor: '#E5E7EB',
      }}>
        {/* HUD */}
        <Stepper step={round} total={5} />
        <View style={{ alignSelf: 'center', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, backgroundColor: '#111827', marginBottom: 10 }}>
          <Text style={{ color: '#fff', fontWeight: '800' }}>Score: {score}</Text>
        </View>

        <View style={{ alignItems: 'center', marginBottom: 24 }}>
          <Text style={{ fontSize: 28, fontWeight: '800', color: '#111827', marginBottom: 8, textAlign: 'center' }}>
            Find {target.label}
          </Text>
          <Animated.View style={[{ alignItems: 'center' }, pulseStyle]}>
            <Text style={{ color: '#6B7280', fontSize: 14, fontWeight: '600' }}>
              Tap the correct picture
            </Text>
          </Animated.View>
        </View>

        {/* Fireworks on correct */}
        {pmFeedback === 'ok' && <SparkleBurst key={fxKey} visible color="#22C55E" />}

        <View style={{ marginBottom: 20 }}>
          <FlatList
            data={(choices || []).filter(Boolean)}
            keyExtractor={(t, i) => (t && t.id ? String(t.id) : `choice-${i}`)}
            numColumns={3}
            columnWrapperStyle={{ justifyContent: 'space-between', gap: 12 }}
            contentContainerStyle={{ gap: 12 }}
            bounces={false}
            overScrollMode="never"
            renderItem={({ item }) => (item ? <ChoiceCard tile={item} onPress={() => onPick(item)} /> : null)}
          />
        </View>

        {/* Toast overlay */}
        <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, alignItems: 'center', zIndex: 40 }}>
          <ResultToast text={pmFeedback === 'ok' ? 'Correct!' : 'Oops!'} type={pmFeedback === 'ok' ? 'ok' : 'bad'} show={!!pmFeedback} />
        </View>

        {done ? <Text className="mt-3 text-green-600 font-semibold text-center">Saved! XP updated ✅</Text> : null}
      </View>
    </SafeAreaView>
  );
}

// -------------------- Game: Quick Sort (Food vs Transport) --------------------
function QuickSort({ onBack }: { onBack: () => void }) {
  const router = useRouter();
  const [qIndex, setQIndex] = useState(0);
  const [score, setScore] = useState(0);
  const [item, setItem] = useState<Tile | null>(null);
  const [done, setDone] = useState(false);
  const [choices, setChoices] = useState<CatId[]>(['food', 'transport']);
  const [correctCat, setCorrectCat] = useState<CatId | null>(null);
  const [qsFeedback, setQsFeedback] = useState<null | 'correct' | 'wrong'>(null);
  const [finalScore, setFinalScore] = useState<{ correct: number; total: number; xp: number } | null>(null);
  const [logTimestamp, setLogTimestamp] = useState<string | null>(null);
  const qsToastOpacity = useSharedValue(0);
  const qsToastY = useSharedValue(12);
  const qsToastStyle = useAnimatedStyle(() => ({ opacity: qsToastOpacity.value, transform: [{ translateY: qsToastY.value }] }));

  const jiggle = useSharedValue(0);
  const jiggleStyle = useJiggleStyle(jiggle);

  const QUESTIONS = useMemo(() => {
    const pool = [
      ...(FOOD || []).slice(0, 10),
      ...(TRANSPORT || []).slice(0, 10),
      ...(JOBS || []).slice(0, 10),
      ...(EMOTIONS || []).slice(0, 10),
      ...(ACTIONS || []).slice(0, 10),
    ];
    return shuffle(pool.filter(Boolean)).slice(0, 8);
  }, []);

  const detectCategory = (t: Tile): CatId | null => {
    const id = t.id;
    if ((FOOD || []).some((x) => x?.id === id)) return 'food';
    if ((TRANSPORT || []).some((x) => x?.id === id)) return 'transport';
    if ((JOBS || []).some((x) => x?.id === id)) return 'jobs';
    if ((EMOTIONS || []).some((x) => x?.id === id)) return 'emotions';
    if ((ACTIONS || []).some((x) => x?.id === id)) return 'actions';
    return null;
  };

  const next = useCallback(() => {
    const t = QUESTIONS[qIndex];
    if (!t) return;
    setItem(t);
    const correct = detectCategory(t);
    setCorrectCat(correct);
    const allCats: CatId[] = ['food', 'transport', 'jobs', 'emotions', 'actions'];
    const other = shuffle(allCats.filter((c) => c !== correct))[0] as CatId;
    setChoices(shuffle([correct as CatId, other]));
    if (t.label) speak(t.label);
  }, [QUESTIONS, qIndex]);

  useEffect(() => {
    next();
  }, [next]);

  const answer = async (cat: CatId) => {
    if (!item) return;
    const ok = correctCat != null && cat === correctCat;

    if (ok) {
      setScore((s) => s + 1);
      animateCorrect(jiggle);
    } else {
      animateWrong(jiggle);
    }
    setQsFeedback(ok ? 'correct' : 'wrong');
    qsToastOpacity.value = 0; qsToastY.value = 12;
    qsToastOpacity.value = withTiming(1, { duration: 180 });
    qsToastY.value = withTiming(0, { duration: 180 });

    if (qIndex >= 7) {
      setDone(true);
      const finalCorrect = score + (ok ? 1 : 0);
      const total = 8;
      const xp = finalCorrect * 10;
      setFinalScore({ correct: finalCorrect, total, xp });

      try {
        await recordGame(xp);
        const result = await logGameAndAward({
          type: 'sort',
          correct: finalCorrect,
          total,
          accuracy: (finalCorrect / total) * 100,
          xpAwarded: xp,
          skillTags: ['category-sorting'],
        });
        setLogTimestamp(result?.last?.at ?? null);
        // 🔁 tell Home to refetch
        router.setParams({ refreshStats: Date.now().toString() });
      } catch { }

      speak('Great sorting!');
    } else {
      setQIndex((i) => i + 1);
      setTimeout(() => { qsToastOpacity.value = withTiming(0, { duration: 220 }); }, 400);
    }
  };

  // Completion screen
  if (done && finalScore) {
    const allCorrect = finalScore.correct === finalScore.total;
    const accuracyPct = Math.round((finalScore.correct / finalScore.total) * 100);
    return (
      <SafeAreaView className="flex-1 bg-white">
        <TouchableOpacity
          onPress={onBack}
          className="absolute top-12 left-6 px-4 py-2 rounded-full z-10"
          style={{
            backgroundColor: '#111827',
            shadowColor: '#000',
            shadowOpacity: 0.2,
            shadowRadius: 8,
            shadowOffset: { width: 0, height: 4 },
            elevation: 6,
          }}
        >
          <Text className="text-white font-semibold">← Back to Games</Text>
        </TouchableOpacity>

        <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', alignItems: 'center', padding: 24 }}>
          <View className="w-full max-w-xl rounded-3xl p-6 bg-white border border-gray-200 items-center mt-16">
            <Text className="text-6xl mb-4">{allCorrect ? '🎉' : '🎊'}</Text>
            <Text className="text-3xl font-extrabold text-gray-900 mb-2">
              {allCorrect ? 'Perfect Score!' : 'Game Complete!'}
            </Text>
            <Text className="text-xl text-gray-600 mb-4">
              You got {finalScore.correct} out of {finalScore.total} correct!
            </Text>

            <ResultCard
              correct={finalScore.correct}
              total={finalScore.total}
              xpAwarded={finalScore.xp}
              accuracy={accuracyPct}
              logTimestamp={logTimestamp}
              onPlayAgain={() => {
                setQIndex(0);
                setScore(0);
                setDone(false);
                setFinalScore(null);
                setQsFeedback(null);
                setLogTimestamp(null);
                next();
              }}
            />
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  if (!item) return null;

  return (
    <SafeAreaView className="flex-1 items-center justify-center p-6" style={{ backgroundColor: '#FFF7ED' }}>
      <TouchableOpacity
        onPress={onBack}
        className="absolute top-12 left-6 px-4 py-2 rounded-full"
        style={{
          backgroundColor: '#111827',
          shadowColor: '#000',
          shadowOpacity: 0.2,
          shadowRadius: 8,
          shadowOffset: { width: 0, height: 4 },
          elevation: 6,
        }}
      >
        <Text className="text-white font-semibold">← Back to Games</Text>
      </TouchableOpacity>

      <View style={{
        width: '100%',
        maxWidth: 500,
        backgroundColor: '#FFFFFF',
        borderRadius: 32,
        padding: 28,
        shadowColor: '#000',
        shadowOpacity: 0.1,
        shadowRadius: 20,
        shadowOffset: { width: 0, height: 8 },
        elevation: 12,
        borderWidth: 1,
        borderColor: '#E5E7EB',
      }}>
        <View style={{
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 20,
        }}>
          <View style={{
            backgroundColor: '#F59E0B',
            paddingHorizontal: 12,
            paddingVertical: 6,
            borderRadius: 12,
          }}>
            <Text style={{ color: '#FFFFFF', fontSize: 12, fontWeight: '700' }}>
              Question {qIndex + 1}/8
            </Text>
          </View>
          <View style={{
            flexDirection: 'row',
            alignItems: 'center',
            backgroundColor: '#FEF3C7',
            paddingHorizontal: 12,
            paddingVertical: 6,
            borderRadius: 12,
          }}>
            <Text style={{ fontSize: 16, fontWeight: '800', color: '#92400E' }}>
              Score: {score}
            </Text>
          </View>
        </View>

        <View style={{ alignItems: 'center', marginBottom: 24 }}>
          <Animated.View
            style={[
              {
                width: 220,
                height: 180,
                borderRadius: 24,
                overflow: 'hidden',
                borderWidth: 3,
                borderColor: '#F59E0B',
                shadowColor: '#F59E0B',
                shadowOpacity: 0.3,
                shadowRadius: 12,
                shadowOffset: { width: 0, height: 6 },
                elevation: 8,
              },
              jiggleStyle,
            ]}
          >
            {item.imageUrl ? (
              <Image source={{ uri: item.imageUrl }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
            ) : item.imageKey && tileImages[item.imageKey] ? (
              <Image source={tileImages[item.imageKey]} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
            ) : (
              <View style={{ flex: 1, backgroundColor: '#F3F4F6', alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ fontSize: 64 }}>🧩</Text>
              </View>
            )}
          </Animated.View>

          <Text style={{ fontSize: 26, fontWeight: '800', color: '#111827', marginTop: 16, textAlign: 'center' }}>
            {item.label}
          </Text>
          <Text style={{ color: '#6B7280', fontSize: 14, fontWeight: '600', marginTop: 4 }}>
            Choose the right category
          </Text>
        </View>

        <View style={{ flexDirection: 'row', gap: 12 }}>
          <TouchableOpacity
            onPress={() => answer(choices[0])}
            activeOpacity={0.9}
            style={{
              flex: 1,
              borderRadius: 20,
              padding: 20,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: '#10B981',
              shadowColor: '#10B981',
              shadowOpacity: 0.3,
              shadowRadius: 12,
              shadowOffset: { width: 0, height: 6 },
              elevation: 8,
            }}
          >
            <Text style={{ color: '#FFFFFF', fontSize: 18, fontWeight: '800', textTransform: 'uppercase' }}>
              {choices[0]?.toUpperCase()}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => answer(choices[1])}
            activeOpacity={0.9}
            style={{
              flex: 1,
              borderRadius: 20,
              padding: 20,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: '#F59E0B',
              shadowColor: '#F59E0B',
              shadowOpacity: 0.3,
              shadowRadius: 12,
              shadowOffset: { width: 0, height: 6 },
              elevation: 8,
            }}
          >
            <Text style={{ color: '#FFFFFF', fontSize: 18, fontWeight: '800', textTransform: 'uppercase' }}>
              {choices[1]?.toUpperCase()}
            </Text>
          </TouchableOpacity>
        </View>
        <Animated.View style={[{ marginTop: 8 }, qsToastStyle]}>
          {qsFeedback === 'correct' ? (
            <View style={{ backgroundColor: '#DCFCE7', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 18 }}>
              <Text className="text-green-800 font-extrabold">✅ Correct! +10 XP</Text>
            </View>
          ) : qsFeedback === 'wrong' ? (
            <View style={{ backgroundColor: '#FEE2E2', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 18 }}>
              <Text className="text-red-800 font-extrabold">✗ Not this group</Text>
            </View>
          ) : null}
        </Animated.View>

        {done ? <Text className="mt-2 text-green-600 font-semibold text-center">Saved! XP updated ✅</Text> : null}
      </View>
    </SafeAreaView>
  );
}

/* ======================= QUIZ CHALLENGE — Educational Quiz Game ======================= */
type QuestionCategory = 'colors' | 'numbers' | 'animals' | 'shapes' | 'birds';

type Question = {
  category: QuestionCategory;
  question: string;
  correctAnswer: string;
  options: string[];
  emoji?: string;
};

function QuizChallenge({ onBack }: { onBack: () => void }) {
  const router = useRouter();
  const [level, setLevel] = useState(1);
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [score, setScore] = useState(0);
  const [currentQuestion, setCurrentQuestion] = useState<Question | null>(null);
  const [selectedAnswer, setSelectedAnswer] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<'correct' | 'wrong' | null>(null);
  const [locked, setLocked] = useState(false);
  const [gameFinished, setGameFinished] = useState(false);
  const [finalStats, setFinalStats] = useState<{ correct: number; total: number; xp: number; level: number } | null>(null);
  const [logTimestamp, setLogTimestamp] = useState<string | null>(null);
  const [questionsThisLevel, setQuestionsThisLevel] = useState(0);
  const [correctThisLevel, setCorrectThisLevel] = useState(0);
  const [showLevelUp, setShowLevelUp] = useState(false);
  // Track category performance for this game
  const [categoryStats, setCategoryStats] = useState<Record<string, { total: number; correct: number }>>({});

  // Animation values
  const questionScale = useSharedValue(1);
  const optionScale = useSharedValue(1);
  const confettiOpacity = useSharedValue(0);
  const levelUpScale = useSharedValue(0);
  const sparkleRotation = useSharedValue(0);

  const questionStyle = useAnimatedStyle(() => ({
    transform: [{ scale: questionScale.value }],
  }));

  const optionStyle = useAnimatedStyle(() => ({
    transform: [{ scale: optionScale.value }],
  }));

  const confettiStyle = useAnimatedStyle(() => ({
    opacity: confettiOpacity.value,
  }));

  const levelUpStyle = useAnimatedStyle(() => ({
    transform: [{ scale: levelUpScale.value }],
  }));

  const handleBack = () => {
    clearScheduledSpeech();
    lastSpokenQuestionId = null;
    onBack();
  };

  useEffect(() => {
    if (!currentQuestion) return;
    // speak question + options when it becomes active - pass an id (index) so the speak helper is idempotent
    speakQuestionWithOptions(currentQuestion.question, currentQuestion.options, currentQuestionIndex);
  }, [currentQuestion, currentQuestionIndex]);

  useEffect(() => {
    return () => {
      clearScheduledSpeech();
      lastSpokenQuestionId = null;
    };
  }, []);

  // Question pools with increasing difficulty
  const generateQuestion = useCallback((category: QuestionCategory, difficulty: number): Question => {
    const colors = ['Red', 'Blue', 'Green', 'Yellow', 'Orange', 'Purple', 'Pink', 'Brown', 'Black', 'White', 'Gray', 'Cyan', 'Magenta', 'Turquoise', 'Maroon'];
    const numbers = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', '13', '14', '15', '16', '17', '18', '19', '20'];
    const animals = ['Dog', 'Cat', 'Lion', 'Tiger', 'Elephant', 'Bear', 'Rabbit', 'Monkey', 'Horse', 'Cow', 'Pig', 'Sheep', 'Duck', 'Chicken', 'Fish', 'Whale', 'Dolphin', 'Shark', 'Eagle', 'Owl'];
    const shapes = ['Circle', 'Square', 'Triangle', 'Rectangle', 'Star', 'Heart', 'Diamond', 'Oval', 'Pentagon', 'Hexagon', 'Octagon', 'Crescent', 'Arrow', 'Cross', 'Plus'];
    const birds = ['Eagle', 'Owl', 'Parrot', 'Sparrow', 'Crow', 'Pigeon', 'Duck', 'Swan', 'Peacock', 'Penguin', 'Flamingo', 'Hummingbird', 'Woodpecker', 'Robin', 'Canary'];

    const colorEmojis: Record<string, string> = {
      'Red': '🔴', 'Blue': '🔵', 'Green': '🟢', 'Yellow': '🟡', 'Orange': '🟠',
      'Purple': '🟣', 'Pink': '🩷', 'Brown': '🟤', 'Black': '⚫', 'White': '⚪'
    };

    const numberEmojis: Record<string, string> = {
      '1': '1️⃣', '2': '2️⃣', '3': '3️⃣', '4': '4️⃣', '5': '5️⃣',
      '6': '6️⃣', '7': '7️⃣', '8': '8️⃣', '9': '9️⃣', '10': '🔟'
    };

    const animalEmojis: Record<string, string> = {
      'Dog': '🐕', 'Cat': '🐈', 'Lion': '🦁', 'Tiger': '🐅', 'Elephant': '🐘',
      'Bear': '🐻', 'Rabbit': '🐰', 'Monkey': '🐵', 'Horse': '🐴', 'Cow': '🐄'
    };

    const shapeEmojis: Record<string, string> = {
      'Circle': '⭕', 'Square': '⬜', 'Triangle': '🔺', 'Rectangle': '▭', 'Star': '⭐',
      'Heart': '❤️', 'Diamond': '💎', 'Oval': '🔵', 'Pentagon': '⬟', 'Hexagon': '⬡'
    };

    const birdEmojis: Record<string, string> = {
      'Eagle': '🦅', 'Owl': '🦉', 'Parrot': '🦜', 'Sparrow': '🐦', 'Crow': '🐦‍⬛',
      'Pigeon': '🕊️', 'Duck': '🦆', 'Swan': '🦢', 'Peacock': '🦚', 'Penguin': '🐧'
    };

    let pool: string[] = [];
    let emojiMap: Record<string, string> = {};
    let questionText = '';

    switch (category) {
      case 'colors':
        pool = colors;
        emojiMap = colorEmojis;
        questionText = difficulty <= 2 ? 'What color is this?' : difficulty <= 4 ? 'Which color matches?' : 'Identify the color:';
        break;
      case 'numbers':
        pool = numbers;
        emojiMap = numberEmojis;
        questionText = difficulty <= 2 ? 'What number is this?' : difficulty <= 4 ? 'Count and choose:' : 'What number comes next?';
        break;
      case 'animals':
        pool = animals;
        emojiMap = animalEmojis;
        questionText = difficulty <= 2 ? 'What animal is this?' : difficulty <= 4 ? 'Which animal matches?' : 'Identify the animal:';
        break;
      case 'shapes':
        pool = shapes;
        emojiMap = shapeEmojis;
        questionText = difficulty <= 2 ? 'What shape is this?' : difficulty <= 4 ? 'Which shape matches?' : 'Identify the shape:';
        break;
      case 'birds':
        pool = birds;
        emojiMap = birdEmojis;
        questionText = difficulty <= 2 ? 'What bird is this?' : difficulty <= 4 ? 'Which bird matches?' : 'Identify the bird:';
        break;
    }

    // Increase difficulty: more options, harder questions
    const numOptions = Math.min(3 + Math.floor(difficulty / 2), 4);
    const poolSize = Math.min(pool.length, 5 + difficulty * 2);
    const availablePool = pool.slice(0, poolSize);

    const correct = availablePool[Math.floor(Math.random() * availablePool.length)];
    const wrongs = shuffle(availablePool.filter(item => item !== correct));
    const options = shuffle([correct, ...wrongs.slice(0, numOptions - 1)]);

    return {
      category,
      question: questionText,
      correctAnswer: correct,
      options,
      emoji: emojiMap[correct] || '❓',
    };
  }, []);

  const generateLevelQuestions = useCallback((currentLevel: number): Question[] => {
    const categories: QuestionCategory[] = ['colors', 'numbers', 'animals', 'shapes', 'birds'];
    const shuffledCategories = shuffle([...categories]);
    return shuffledCategories.map(cat => generateQuestion(cat, currentLevel));
  }, [generateQuestion]);

  const [levelQuestions, setLevelQuestions] = useState<Question[]>([]);

  useEffect(() => {
    if (!gameFinished) {
      const questions = generateLevelQuestions(level);
      setLevelQuestions(questions);
      setCurrentQuestion(questions[0]);
      setCurrentQuestionIndex(0);
      setQuestionsThisLevel(questions.length);
      setCorrectThisLevel(0);
      // speak first question immediately:
      if (questions[0]) speakQuestionWithOptions(questions[0].question, questions[0].options, 0);
      questionScale.value = withSpring(1.05, { damping: 12 }, () => {
        questionScale.value = withSpring(1, { damping: 14 });
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [level, gameFinished, generateLevelQuestions]);

  const handleAnswer = async (answer: string) => {
    if (locked || !currentQuestion) return;

    setLocked(true);
    setSelectedAnswer(answer);
    const isCorrect = answer === currentQuestion.correctAnswer;
    const category = currentQuestion.category;

    // Update category stats
    setCategoryStats(prev => {
      const catStats = prev[category] || { total: 0, correct: 0 };
      return {
        ...prev,
        [category]: {
          total: catStats.total + 1,
          correct: catStats.correct + (isCorrect ? 1 : 0),
        },
      };
    });

    if (isCorrect) {
      setScore(s => s + 1);
      setCorrectThisLevel(c => c + 1);
      setFeedback('correct');
      optionScale.value = withSpring(1.1, { damping: 10 }, () => {
        optionScale.value = withSpring(1, { damping: 12 });
      });
      speak('Correct! Great job!');
    } else {
      setFeedback('wrong');
      optionScale.value = withTiming(0.95, { duration: 100 }, () => {
        optionScale.value = withSpring(1, { damping: 12 });
      });
      speak('Try again next time!');
    }

    setTimeout(async () => {
      const newCorrectCount = isCorrect ? correctThisLevel + 1 : correctThisLevel;

      if (currentQuestionIndex < levelQuestions.length - 1) {
        // Next question in this level
        const nextIndex = currentQuestionIndex + 1;
        setCurrentQuestionIndex(nextIndex);
        setCurrentQuestion(levelQuestions[nextIndex]);
        setSelectedAnswer(null);
        setFeedback(null);
        setLocked(false);
        questionScale.value = withSpring(1.05, { damping: 12 }, () => {
          questionScale.value = withSpring(1, { damping: 14 });
        });
      } else {
        // Level complete - check if all correct
        if (newCorrectCount === questionsThisLevel) {
          // All correct - level up!
          setShowLevelUp(true);
          confettiOpacity.value = withTiming(1, { duration: 300 });
          levelUpScale.value = withSpring(1.2, { damping: 10 }, () => {
            levelUpScale.value = withSpring(1, { damping: 12 });
          });
          sparkleRotation.value = withRepeat(
            withTiming(360, { duration: 2000, easing: Easing.linear }),
            -1,
            false
          );
          speak(`Level ${level + 1} unlocked! Amazing!`);

          setTimeout(() => {
            confettiOpacity.value = withTiming(0, { duration: 500 });
            levelUpScale.value = withTiming(0, { duration: 300 });
            cancelAnimation(sparkleRotation);
            setShowLevelUp(false);
            setLevel(level + 1);
            setCurrentQuestionIndex(0);
            setSelectedAnswer(null);
            setFeedback(null);
            setLocked(false);
          }, 2000);
        } else {
          // Not all correct - game over
          const totalQuestions = (level - 1) * 5 + questionsThisLevel;
          const totalCorrect = score + (isCorrect ? 1 : 0);
          const xpEarned = totalCorrect * 15 + (level - 1) * 25;

          setFinalStats({
            correct: totalCorrect,
            total: totalQuestions,
            xp: xpEarned,
            level: level,
          });
          setGameFinished(true);

          try {
            // Prepare category performance metadata
            const categoryPerformance: Record<string, { totalQuestions: number; correctAnswers: number }> = {};
            Object.entries(categoryStats).forEach(([category, stats]) => {
              categoryPerformance[category] = {
                totalQuestions: stats.total,
                correctAnswers: stats.correct,
              };
            });

            // Map quiz categories to skill IDs
            const categoryToSkill: Record<string, string> = {
              'colors': 'color-recognition',
              'numbers': 'number-sense',
              'animals': 'animal-knowledge',
              'shapes': 'shape-awareness',
              'birds': 'bird-knowledge',
            };
            const skillTags = Object.keys(categoryStats).map(cat => categoryToSkill[cat]).filter(Boolean);

            await recordGame(xpEarned); // Update XP in user rewards
            const result = await logGameAndAward({
              type: 'quiz',
              correct: totalCorrect,
              total: totalQuestions,
              accuracy: (totalCorrect / totalQuestions) * 100,
              xpAwarded: xpEarned,
              skillTags: skillTags.length > 0 ? skillTags : ['number-sense'], // fallback
              meta: {
                level: level,
                categoryPerformance: categoryPerformance,
              },
            });
            setLogTimestamp(result?.last?.at ?? null);
            // 🔁 tell Home to refetch
            router.setParams({ refreshStats: Date.now().toString() });
          } catch (e) {
            console.error('Failed to save quiz game:', e);
          }

          speak(`Game over! You reached level ${level}!`);
        }
      }
    }, isCorrect ? 1500 : 2000);
  };

  // Game finished screen
  if (gameFinished && finalStats) {
    const accuracyPct = Math.round((finalStats.correct / finalStats.total) * 100);
    return (
      <SafeAreaView className="flex-1 items-center justify-center p-6 bg-white">
        <TouchableOpacity
          onPress={handleBack}
          className="absolute top-12 left-6 px-4 py-2 rounded-full"
          style={{
            backgroundColor: '#111827',
            shadowColor: '#000',
            shadowOpacity: 0.2,
            shadowRadius: 8,
            shadowOffset: { width: 0, height: 4 },
            elevation: 6,
          }}
        >
          <Text className="text-white font-semibold">← Back to Games</Text>
        </TouchableOpacity>

        <View className="w-full max-w-xl rounded-3xl p-6 bg-white border border-gray-200 items-center">
          <Text className="text-6xl mb-4">🎓</Text>
          <Text className="text-3xl font-extrabold text-gray-900 mb-2">Quiz Complete!</Text>
          <Text className="text-xl text-gray-600 mb-2 text-center">
            You reached Level {finalStats.level}!
          </Text>
          <Text className="text-lg text-gray-500 mb-4 text-center">
            {finalStats.correct} out of {finalStats.total} correct
          </Text>

          <ResultCard
            correct={finalStats.correct}
            total={finalStats.total}
            xpAwarded={finalStats.xp}
            accuracy={accuracyPct}
            logTimestamp={logTimestamp}
            onPlayAgain={() => {
              setLevel(1);
              setScore(0);
              setCurrentQuestionIndex(0);
              setGameFinished(false);
              setFinalStats(null);
              setFeedback(null);
              setLocked(false);
              setSelectedAnswer(null);
              setCategoryStats({});
              setLogTimestamp(null);
            }}
          />

          <Text className="text-green-600 font-semibold text-center mt-4">Saved! XP updated ✅</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!currentQuestion) return null;

  const categoryColors: Record<QuestionCategory, string> = {
    colors: '#EF4444',
    numbers: '#3B82F6',
    animals: '#10B981',
    shapes: '#F59E0B',
    birds: '#8B5CF6',
  };

  const categoryGradients: Record<QuestionCategory, [string, string]> = {
    colors: ['#EF4444', '#F87171'],
    numbers: ['#3B82F6', '#60A5FA'],
    animals: ['#10B981', '#34D399'],
    shapes: ['#F59E0B', '#FBBF24'],
    birds: ['#8B5CF6', '#A78BFA'],
  };

  const bgColor = categoryColors[currentQuestion.category];
  const gradient = categoryGradients[currentQuestion.category];

  return (
    <SafeAreaView className="flex-1 items-center justify-center p-6" style={{ backgroundColor: `${bgColor}15` }}>
      <TouchableOpacity
        onPress={handleBack}
        className="absolute top-12 left-6 px-4 py-2 rounded-full z-10"
        style={{
          backgroundColor: '#111827',
          shadowColor: '#000',
          shadowOpacity: 0.2,
          shadowRadius: 8,
          shadowOffset: { width: 0, height: 4 },
          elevation: 6,
        }}
      >
        <Text className="text-white font-semibold">← Back to Games</Text>
      </TouchableOpacity>

      {/* Level Up Animation */}
      {showLevelUp && (
        <Animated.View
          style={[
            {
              position: 'absolute',
              top: '30%',
              zIndex: 50,
              alignItems: 'center',
            },
            levelUpStyle,
          ]}
          pointerEvents="none"
        >
          <Text style={{ fontSize: 64, fontWeight: '900', color: '#9333EA' }}>⭐</Text>
          <Text style={{ fontSize: 32, fontWeight: '800', color: '#9333EA', marginTop: 8 }}>
            Level {level + 1}!
          </Text>
        </Animated.View>
      )}

      {/* Confetti Effect */}
      <Animated.View style={[{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 40, pointerEvents: 'none' }, confettiStyle]}>
        <SparkleBurst visible color={bgColor} />
      </Animated.View>

      <View style={{
        width: '100%',
        maxWidth: 500,
        backgroundColor: '#FFFFFF',
        borderRadius: 32,
        padding: 28,
        shadowColor: '#000',
        shadowOpacity: 0.15,
        shadowRadius: 24,
        shadowOffset: { width: 0, height: 10 },
        elevation: 12,
        borderWidth: 2,
        borderColor: `${bgColor}40`,
      }}>
        {/* Header */}
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <View style={{
            backgroundColor: bgColor,
            paddingHorizontal: 16,
            paddingVertical: 8,
            borderRadius: 20,
          }}>
            <Text style={{ color: '#FFFFFF', fontSize: 14, fontWeight: '800' }}>
              Level {level}
            </Text>
          </View>
          <View style={{
            flexDirection: 'row',
            alignItems: 'center',
            backgroundColor: '#F3F4F6',
            paddingHorizontal: 14,
            paddingVertical: 8,
            borderRadius: 20,
          }}>
            <Text style={{ fontSize: 16, fontWeight: '800', color: '#1F2937' }}>
              Score: {score} 🎯
            </Text>
          </View>
        </View>

        {/* Progress Indicator */}
        <View style={{ marginBottom: 24 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 }}>
            <Text style={{ fontSize: 12, fontWeight: '600', color: '#6B7280' }}>
              Question {currentQuestionIndex + 1} of {questionsThisLevel}
            </Text>
            <Text style={{ fontSize: 12, fontWeight: '600', color: '#6B7280' }}>
              {currentQuestion.category.charAt(0).toUpperCase() + currentQuestion.category.slice(1)}
            </Text>
          </View>
          <View style={{ height: 6, backgroundColor: '#E5E7EB', borderRadius: 3, overflow: 'hidden' }}>
            <LinearGradient
              colors={gradient}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={{
                height: '100%',
                width: `${((currentQuestionIndex + 1) / questionsThisLevel) * 100}%`,
                borderRadius: 3,
              }}
            />
          </View>
        </View>

        {/* Question */}
        <Animated.View style={[{ alignItems: 'center', marginBottom: 32 }, questionStyle]}>
          <View style={{
            width: 120,
            height: 120,
            borderRadius: 60,
            backgroundColor: `${bgColor}20`,
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: 20,
            borderWidth: 4,
            borderColor: bgColor,
          }}>
            <Text style={{ fontSize: 64 }}>{currentQuestion.emoji}</Text>
          </View>
          <Text style={{
            fontSize: 24,
            fontWeight: '800',
            color: '#111827',
            marginBottom: 8,
            textAlign: 'center',
          }}>
            {currentQuestion.question}
          </Text>
        </Animated.View>

        {/* Options */}
        <View style={{ gap: 12 }}>
          {currentQuestion.options.map((option, index) => {
            const isSelected = selectedAnswer === option;
            const isCorrect = option === currentQuestion.correctAnswer;
            const showFeedback = feedback !== null;

            let optionBg = '#F3F4F6';
            let optionBorder = '#E5E7EB';
            let textColor = '#111827';

            if (showFeedback) {
              if (isSelected && isCorrect) {
                optionBg = '#10B981';
                optionBorder = '#10B981';
                textColor = '#FFFFFF';
              } else if (isSelected && !isCorrect) {
                optionBg = '#EF4444';
                optionBorder = '#EF4444';
                textColor = '#FFFFFF';
              } else if (!isSelected && isCorrect && feedback === 'wrong') {
                optionBg = '#D1FAE5';
                optionBorder = '#10B981';
                textColor = '#065F46';
              }
            }

            return (
              <Animated.View key={option} style={optionStyle}>
                <TouchableOpacity
                  onPress={() => handleAnswer(option)}
                  disabled={locked}
                  activeOpacity={0.8}
                  style={{
                    backgroundColor: optionBg,
                    borderWidth: 2,
                    borderColor: optionBorder,
                    borderRadius: 20,
                    padding: 20,
                    alignItems: 'center',
                    shadowColor: isSelected ? bgColor : '#000',
                    shadowOpacity: isSelected ? 0.3 : 0.1,
                    shadowRadius: isSelected ? 12 : 4,
                    shadowOffset: { width: 0, height: isSelected ? 6 : 2 },
                    elevation: isSelected ? 8 : 2,
                  }}
                >
                  <Text style={{
                    fontSize: 20,
                    fontWeight: '800',
                    color: textColor,
                  }}>
                    {option}
                  </Text>
                  {showFeedback && isSelected && (
                    <Text style={{ marginTop: 4, fontSize: 24 }}>
                      {isCorrect ? '✅' : '❌'}
                    </Text>
                  )}
                </TouchableOpacity>
              </Animated.View>
            );
          })}
        </View>

        {/* Feedback Toast */}
        {feedback && (
          <Animated.View
            entering={FadeInUp.springify().damping(14)}
            style={{
              marginTop: 16,
              backgroundColor: feedback === 'correct' ? '#D1FAE5' : '#FEE2E2',
              paddingHorizontal: 16,
              paddingVertical: 12,
              borderRadius: 16,
              alignItems: 'center',
            }}
          >
            <Text style={{
              fontSize: 18,
              fontWeight: '800',
              color: feedback === 'correct' ? '#065F46' : '#991B1B',
            }}>
              {feedback === 'correct' ? '🎉 Correct! Great job!' : '😔 Not quite, but keep trying!'}
            </Text>
          </Animated.View>
        )}
      </View>
    </SafeAreaView>
  );
}

/* ======================= FIND EMOJI — Reanimated v3 (web-safe) ======================= */
function FindEmoji({ onBack }: { onBack: () => void }) {
  const router = useRouter();
  // Create a safe pool: must have a visual (emoji/image) and always have a label
  const POOL: Tile[] = useMemo(() => {
    const list = (EMOTIONS || []).filter(Boolean).filter(t => t.emoji || (t as any).imageKey);
    return list.map((t) => ({
      ...t,
      // derive a readable label if missing
      label: t.label ?? (typeof t.id === 'string'
        ? t.id.replace(/[_-]+/g, ' ')
        : String(t.id)
      ),
    }));
  }, []);


  const TOTAL = 6;
  const [round, setRound] = useState(1);
  const [score, setScore] = useState(0);

  // Frozen per-round data
  const [target, setTarget] = useState<Tile | null>(null);
  const [options, setOptions] = useState<Tile[]>([]);
  const [freezeKey, setFreezeKey] = useState(0);
  const [locked, setLocked] = useState(false);
  const [finished, setFinished] = useState(false);
  const [allCorrect, setAllCorrect] = useState(false);
  const [feedback, setFeedback] = useState<null | "correct" | "wrong">(null);
  const [finalScore, setFinalScore] = useState<{ correct: number; total: number; xp: number } | null>(null);
  const [logTimestamp, setLogTimestamp] = useState<string | null>(null);

  // Reanimated values (already imported at top of file)
  const scale = useSharedValue(1);
  const toastOpacity = useSharedValue(0);
  const toastY = useSharedValue(12);

  const emojiStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  const toastStyle = useAnimatedStyle(() => ({
    opacity: toastOpacity.value,
    transform: [{ translateY: toastY.value }],
  }));

  const pulse = useCallback(() => {
    scale.value = 1;
    scale.value = withSpring(1.06, { damping: 14, stiffness: 240 }, () => {
      scale.value = withSpring(1, { damping: 14, stiffness: 220 });
    });
  }, [scale]);

  const showToast = () => {
    toastOpacity.value = 0;
    toastY.value = 12;
    toastOpacity.value = withTiming(1, { duration: 180 });
    toastY.value = withTiming(0, { duration: 180 });
    setTimeout(() => { toastOpacity.value = withTiming(0, { duration: 220 }); }, 420);
  };

  const makeRound = useCallback(() => {
    if (!POOL.length) return;
    const correct = POOL[Math.floor(Math.random() * POOL.length)];
    const wrongs = shuffle(POOL.filter(t => t.id !== correct.id)).slice(0, 3);
    const opts = shuffle([correct, ...wrongs]); // 4 options, frozen for this round

    setTarget(correct);
    setOptions(opts);
    const newFreezeKey = Date.now();
    setFreezeKey(newFreezeKey);   // keep FlatList stable this round
    setFeedback(null);
    setLocked(false);
    pulse();
    
    // Speak question with options after state updates
    setTimeout(() => {
      const question = "What feeling is this?";
      const optionLabels = opts.map(opt => 
        opt.label ?? (typeof opt.id === 'string' ? opt.id.replace(/[_-]+/g, ' ') : String(opt.id))
      );
      speakQuestionWithOptions(question, optionLabels, newFreezeKey);
    }, 100);
  }, [POOL, pulse]);

  useEffect(() => { if (POOL.length) makeRound(); }, [POOL.length, makeRound]);

  // Handle back navigation with speech cleanup
  const handleBack = useCallback(() => {
    clearScheduledSpeech();
    lastSpokenQuestionId = null;
    onBack();
  }, [onBack]);

  // Cleanup speech on unmount
  useEffect(() => {
    return () => {
      clearScheduledSpeech();
      lastSpokenQuestionId = null;
    };
  }, []);

  const afterAnswer = (ok: boolean) => {
    if (round >= TOTAL) {
      const finalCorrect = score + (ok ? 1 : 0);
      const xp = finalCorrect * 10;
      setFinalScore({ correct: finalCorrect, total: TOTAL, xp });
      setFinished(true);
      setAllCorrect(finalCorrect === TOTAL);
      speak(finalCorrect === TOTAL ? 'Perfect score! Amazing!' : `Well done! You got ${finalCorrect} out of ${TOTAL}!`);
      (async () => {
        try {
          await recordGame(xp);
          const result = await logGameAndAward({
            type: "emoji",
            correct: finalCorrect,
            total: TOTAL,
            accuracy: (finalCorrect / TOTAL) * 100,
            xpAwarded: xp,
            skillTags: ['emotion-identification'],
          });
          setLogTimestamp(result?.last?.at ?? null);
          // 🔁 tell Home to refetch
          router.setParams({ refreshStats: Date.now().toString() });
        } catch { }
      })();
    } else {
      setRound(r => r + 1);
      setTimeout(makeRound, 420);
    }
  };

  const onPick = (item: Tile) => {
    if (locked || !target) return;
    setLocked(true);
    const ok = item.id === target.id;
    setFeedback(ok ? "correct" : "wrong");
    if (ok) setScore(s => s + 1);
    showToast();
    pulse();
    setTimeout(() => afterAnswer(ok), 260);
  };

  if (!POOL.length || !target || options.length !== 4) {
    return (
      <SafeAreaView className="flex-1 items-center justify-center p-6 bg-white">
        <TouchableOpacity
          onPress={handleBack}
          className="absolute top-12 left-6 px-4 py-2 rounded-full"
          style={{
            backgroundColor: '#111827',
            shadowColor: '#000',
            shadowOpacity: 0.2,
            shadowRadius: 8,
            shadowOffset: { width: 0, height: 4 },
            elevation: 6,
          }}
        >
          <Text className="text-white font-semibold">← Back to Games</Text>
        </TouchableOpacity>
        <View className="rounded-3xl p-6 bg-white border border-gray-200">
          <Text>No emoji tiles found.</Text>
        </View>
      </SafeAreaView>
    );
  }

  // Game finished - show completion screen
  if (finished && finalScore) {
    const accuracyPct = Math.round((finalScore.correct / finalScore.total) * 100);
    return (
      <SafeAreaView className="flex-1 items-center justify-center p-6 bg-white">
        <TouchableOpacity
          onPress={handleBack}
          className="absolute top-12 left-6 px-4 py-2 rounded-full"
          style={{
            backgroundColor: '#111827',
            shadowColor: '#000',
            shadowOpacity: 0.2,
            shadowRadius: 8,
            shadowOffset: { width: 0, height: 4 },
            elevation: 6,
          }}
        >
          <Text className="text-white font-semibold">← Back to Games</Text>
        </TouchableOpacity>

        <View className="w-full max-w-xl rounded-3xl p-6 bg-white border border-gray-200 items-center">
          <Text className="text-6xl mb-4">{allCorrect ? '🎉' : '🎊'}</Text>
          <Text className="text-3xl font-extrabold text-gray-900 mb-2">
            {allCorrect ? 'Perfect Score!' : 'Game Complete!'}
          </Text>
          <Text className="text-xl text-gray-600 mb-4">
            You got {finalScore.correct} out of {finalScore.total} correct!
          </Text>

          <ResultCard
            correct={finalScore.correct}
            total={finalScore.total}
            xpAwarded={finalScore.xp}
            accuracy={accuracyPct}
            logTimestamp={logTimestamp}
            onPlayAgain={() => {
              setRound(1);
              setScore(0);
              setFinished(false);
              setAllCorrect(false);
              setFinalScore(null);
              setFeedback(null);
              setLocked(false);
              setLogTimestamp(null);
              makeRound();
            }}
          />

          <Text className="text-green-600 font-semibold text-center mt-4">Saved! XP updated ✅</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 items-center justify-center p-6 bg-white">
      <TouchableOpacity
        onPress={handleBack}
        className="absolute top-12 left-6 px-4 py-2 rounded-full"
        style={{
          backgroundColor: '#111827',
          shadowColor: '#000',
          shadowOpacity: 0.2,
          shadowRadius: 8,
          shadowOffset: { width: 0, height: 4 },
          elevation: 6,
        }}
      >
        <Text className="text-white font-semibold">← Back to Games</Text>
      </TouchableOpacity>

      <View className="w-full max-w-xl rounded-3xl p-6 bg-white border border-gray-200 items-center">
        <Text className="text-xs text-gray-500">Round {round}/{TOTAL}</Text>

        <Animated.View style={[{ marginTop: 12, alignItems: "center" }, emojiStyle]}>
          <Text style={{ fontSize: 72 }}>{target.emoji || "🙂"}</Text>
        </Animated.View>
        <Text className="text-gray-600 mt-2">What feeling is this?</Text>

        <FlatList
          style={{ width: "100%", marginTop: 10 }}
          data={options.map(o => ({ ...o, _k: freezeKey }))} // frozen keys
          keyExtractor={(it, i) => `${it.id}-${freezeKey}-${i}`}
          numColumns={2}
          columnWrapperStyle={{ justifyContent: "space-between" }}
          bounces={false}
          overScrollMode="never"
          renderItem={({ item }) => (
            <TouchableOpacity
              onPress={() => onPick(item)}
              activeOpacity={0.9}
              disabled={locked}
              style={{
                width: "48%",
                paddingVertical: 14,
                marginBottom: 10,
                borderRadius: 16,
                backgroundColor: "#F3F4F6",
                borderWidth: 1,
                borderColor: "#E5E7EB",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Text className="font-extrabold text-gray-900">
                {item.label ?? (typeof item.id === 'string' ? item.id.replace(/[_-]+/g, ' ') : String(item.id))}
              </Text>


            </TouchableOpacity>
          )}
        />

        <Animated.View style={[{ marginTop: 6 }, toastStyle]}>
          {feedback === "correct" ? (
            <View style={{ backgroundColor: "#DCFCE7", paddingHorizontal: 14, paddingVertical: 8, borderRadius: 18 }}>
              <Text className="text-green-800 font-extrabold">✅ Correct! +10 XP</Text>
            </View>
          ) : feedback === "wrong" ? (
            <View style={{ backgroundColor: "#FEE2E2", paddingHorizontal: 14, paddingVertical: 8, borderRadius: 18 }}>
              <Text className="text-red-800 font-extrabold">✗ Oops! Try the next one</Text>
            </View>
          ) : null}
        </Animated.View>

        <Text className="mt-3 text-gray-700">
          Score: <Text className="font-extrabold">{score}</Text>
        </Text>
      </View>
    </SafeAreaView>
  );
}





// -------------------- Menu screen --------------------
type GameKey = 'menu' | 'bigTap' | 'tap' | 'match' | 'sort' | 'emoji' | 'quiz' | 'tapRedCircle' | 'balloonPop' | 'tapAndHold' | 'multiTap';

type MenuGame = {
  id: GameKey;
  title: string;
  emoji: string;
  description: string;
  color: string;
  gradient: [string, string];
  icon?: any;
};

function GameCard({ game, index, onPress, locked, unlockLevel }: { game: MenuGame; index: number; onPress: () => void; locked?: boolean; unlockLevel?: number }) {
  const press = useSharedValue(0);
  const softGradient = useMemo<[string, string]>(
    () => [`${game.gradient[0]}1C`, `${game.gradient[1]}05`],
    [game.gradient]
  );

  const pressStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 1 - press.value * 0.04 }],
  }));

  return (
    <Animated.View
      style={menuStyles.gameCardWrapper}
      entering={FadeInUp.delay(index * 90).springify().damping(14)}
    >
      <TouchableOpacity
        onPressIn={() => (press.value = withTiming(1, { duration: 100 }))}
        onPressOut={() => (press.value = withTiming(0, { duration: 160 }))}
        onPress={onPress}
        activeOpacity={0.92}
        disabled={locked}
      >
        <Animated.View style={[menuStyles.gameCard, pressStyle]}
        >
          <LinearGradient colors={softGradient} style={menuStyles.cardGlow} />

          <View style={menuStyles.cardHeader}>
            <View style={[menuStyles.iconBadge, { backgroundColor: game.color + '1A' }]}>
              <Text style={menuStyles.iconEmoji}>{game.emoji}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={menuStyles.cardTitle}>{game.title}</Text>
              <Text style={menuStyles.cardSubtitle}>{game.description}</Text>
            </View>
            <View style={[menuStyles.playBadge, { backgroundColor: game.color + '1F' }]}
            >
              <Ionicons name="play" size={20} color={game.color} />
            </View>
          </View>

          <LinearGradient
            colors={game.gradient}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={menuStyles.progressBar}
          />

          {locked && (
            <View style={menuStyles.lockOverlay}>
              <Ionicons name="lock-closed" size={18} color="#1E293B" />
              <Text style={menuStyles.lockText}>
                {unlockLevel ? `Unlock at Level ${unlockLevel}` : 'Level up to unlock'}
              </Text>
            </View>
          )}
        </Animated.View>
      </TouchableOpacity>
    </Animated.View>
  );
}

export default function GamesScreen() {
  const [screen, setScreen] = useState<GameKey>('menu');
  const [stats, setStats] = useState<{ xp?: number; streakDays?: number; globalLevel?: number } | null>(null);

  const heroFloat = useSharedValue(0);
  const headerReveal = useSharedValue(0);

  useEffect(() => {
    headerReveal.value = withTiming(1, { duration: 520, easing: Easing.out(Easing.cubic) });
    heroFloat.value = withRepeat(withTiming(1, { duration: 2600, easing: Easing.inOut(Easing.quad) }), -1, true);
  }, [headerReveal, heroFloat]);

  const headerStyle = useAnimatedStyle(() => ({
    opacity: headerReveal.value,
    transform: [{ translateY: (1 - headerReveal.value) * 24 }],
  }));

  const heroStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: (heroFloat.value - 0.5) * 10 }],
  }));

  useEffect(() => {
    (async () => {
      try {
        const s = await fetchMyStats();
        setStats({ xp: s?.xp ?? 0, streakDays: s?.streakDays ?? 0, globalLevel: s?.globalLevel ?? 1 });
      } catch { }
    })();
  }, []);

  if (screen === 'bigTap') return <BigTapTarget onBack={() => setScreen('menu')} />;
  if (screen === 'tap') return <TapTiming onBack={() => setScreen('menu')} />;
  if (screen === 'match') return <PictureMatch onBack={() => setScreen('menu')} />;
  if (screen === 'sort') return <QuickSort onBack={() => setScreen('menu')} />;
  if (screen === 'emoji') return <FindEmoji onBack={() => setScreen('menu')} />;
  if (screen === 'quiz') return <QuizChallenge onBack={() => setScreen('menu')} />;
  if (screen === 'tapRedCircle') return <TapRedCircleGame onBack={() => setScreen('menu')} />;
  if (screen === 'balloonPop') return <BalloonPopGame onBack={() => setScreen('menu')} />;
  if (screen === 'tapAndHold') return <TapAndHoldGame onBack={() => setScreen('menu')} />;
  if (screen === 'multiTap') return <MultiTapFunGame onBack={() => setScreen('menu')} />;

  // Menu UI with beautiful cards
  const games: MenuGame[] = [
    {
      id: 'bigTap',
      title: 'Big Tap Target',
      emoji: '🫧',
      description: 'Tap the big bubble to pop it! Track stars as you go.',
      color: '#22C55E',
      gradient: ['#22C55E', '#16A34A'] as [string, string],
      icon: images.tapIcon,
    },
    {
      id: 'tap',
      title: 'Tap Timing',
      emoji: '🎯',
      description: 'Test your timing skills! Tap when the timer matches the target.',
      color: '#6366F1',
      gradient: ['#6366F1', '#8B5CF6'] as [string, string],
      icon: images.tapIcon,
    },
    {
      id: 'match',
      title: 'Picture Match',
      emoji: '🖼️',
      description: 'Find the matching picture from the options shown.',
      color: '#22C55E',
      gradient: ['#22C55E', '#10B981'] as [string, string],
    },
    {
      id: 'sort',
      title: 'Quick Sort',
      emoji: '🍎',
      description: 'Sort items into the correct categories!',
      color: '#F59E0B',
      gradient: ['#F59E0B', '#F97316'] as [string, string],
    },
    {
      id: 'emoji',
      title: 'Find the Emoji',
      emoji: '😊',
      description: 'Match the feeling shown by the emoji!',
      color: '#06B6D4',
      gradient: ['#06B6D4', '#3B82F6'] as [string, string],
    },
    {
      id: 'quiz',
      title: 'Quiz Challenge',
      emoji: '🎓',
      description: 'Test your knowledge! Colors, numbers, animals, shapes & birds!',
      color: '#9333EA',
      gradient: ['#9333EA', '#A855F7'] as [string, string],
    },
    {
      id: 'tapRedCircle',
      title: 'Red Circle Tap',
      emoji: '🔴',
      description: 'Tap the glowing red circle to build motor control and attention!',
      color: '#EF4444',
      gradient: ['#EF4444', '#DC2626'] as [string, string],
    },
    {
      id: 'balloonPop',
      title: 'Balloon Pop',
      emoji: '🎈',
      description: 'Tap the balloon as it moves slowly across the screen. Build hand-eye coordination!',
      color: '#8B5CF6',
      gradient: ['#8B5CF6', '#D946EF'] as [string, string],
    },
    {
      id: 'tapAndHold',
      title: 'Tap and Hold',
      emoji: '✨',
      description: 'Tap and hold the button for 2 seconds. Build finger control and endurance!',
      color: '#3B82F6',
      gradient: ['#3B82F6', '#06B6D4'] as [string, string],
    },
    {
      id: 'multiTap',
      title: 'Multi-Tap Fun',
      emoji: '🎈',
      description: 'Tap all 5 balloons one by one! Build coordination and finger precision!',
      color: '#F472B6',
      gradient: ['#F472B6', '#EC4899'] as [string, string],
    },
  ];

  const levelGates: Partial<Record<GameKey, number>> = {
    sort: 1.5,
    emoji: 1.3,
    quiz: 2.3,
  };

  const currentLevel = stats?.globalLevel ?? 1;
  const computeLocked = (id: GameKey) => {
    const gate = levelGates[id];
    return typeof gate === 'number' ? currentLevel < gate : false;
  };

  return (
    <SafeAreaView style={{ flex: 1 }}>
      <View style={{ flex: 1 }}>
        <LinearGradient
          colors={['#E0F2FE', '#F1F5FF', '#FFFFFF'] as [string, string, string]}
          style={StyleSheet.absoluteFillObject}
        />
        <ScrollView contentContainerStyle={{ padding: 20 }} showsVerticalScrollIndicator={false}>
          {/* Header */}
          <Animated.View style={[menuStyles.headerWrap, headerStyle]}>
            <Animated.View style={[menuStyles.heroBadge, heroStyle]}>
              <LinearGradient
                colors={['#3B82F6', '#6366F1']}
                style={menuStyles.heroGradient}
              >
                <Ionicons name="game-controller" size={40} color="#fff" />
              </LinearGradient>
            </Animated.View>
            <Text style={menuStyles.heroTitle}>Games</Text>
            {stats && (
              <Animated.View
                entering={FadeInDown.delay(120).springify().damping(18)}
                style={menuStyles.statsRow}
              >
                <View style={menuStyles.statChip}>
                  <Ionicons name="star" size={16} color="#F59E0B" />
                  <Text style={menuStyles.statText}>{stats.xp} XP</Text>
                </View>
                <View style={menuStyles.statChip}>
                  <Ionicons name="flame" size={16} color="#F97316" />
                  <Text style={menuStyles.statText}>{stats.streakDays} days</Text>
                </View>
              </Animated.View>
            )}
          </Animated.View>

          {/* Games Grid */}
          <Animated.Text
            entering={FadeInDown.delay(220)}
            style={menuStyles.sectionHeading}
          >
            Choose a Game
          </Animated.Text>
          <View style={{ gap: 18 }}>
            {games.map((game, index) => {
              const locked = computeLocked(game.id);
              return (
                <GameCard
                  key={game.id}
                  game={game}
                  index={index}
                  locked={locked}
                  unlockLevel={levelGates[game.id]}
                  onPress={() => {
                    if (locked) return;
                    setScreen(game.id as GameKey);
                  }}
                />
              );
            })}
          </View>
        </ScrollView>
      </View>
    </SafeAreaView >
  );
}

// -------------------- Tiny animation helpers --------------------
function useScaleStyle(v: any) {
  return useAnimatedStyle(() => ({ transform: [{ scale: v.value }] }));
}
function animatePulse(v: any, good: boolean) {
  v.value = withTiming(good ? 1.06 : 0.94, { duration: 160 }, () => {
    v.value = withSpring(1, { damping: 14, stiffness: 240 });
  });
}
function useJiggleStyle(v: any) {
  return useAnimatedStyle(() => ({ transform: [{ translateX: v.value }] }));
}
function animateCorrect(v: any) {
  v.value = 0;
  v.value = withTiming(8, { duration: 90 }, () => {
    v.value = withSpring(0, { damping: 12, stiffness: 240 });
  });
}
function animateWrong(v: any) {
  v.value = 0;
  v.value = withTiming(-8, { duration: 90 }, () => {
    v.value = withSpring(0, { damping: 12, stiffness: 240 });
  });
}

// -------------------- Small components --------------------
function ChoiceCard({ tile, onPress }: { tile?: Tile; onPress: () => void }) {
  if (!tile || !tile.id) return null;
  // Use a simple, non-hook-based implementation to avoid accidental "hooks called conditionally" lint
  return (
    <View style={{ width: '31%', aspectRatio: 1, marginBottom: 10, borderRadius: 14, overflow: 'hidden' }}>
      <TouchableOpacity
        onPress={() => onPress()}
        activeOpacity={0.9}
        style={{ flex: 1, borderWidth: 1, borderColor: '#E5E7EB', backgroundColor: '#fff' }}
      >
        {tile.imageUrl ? (
          <Image source={{ uri: tile.imageUrl }} style={{ width: '100%', height: '78%' }} resizeMode="cover" />
        ) : tile.imageKey && tileImages[tile.imageKey] ? (
          <Image source={tileImages[tile.imageKey]} style={{ width: '100%', height: '78%' }} resizeMode="cover" />
        ) : (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ fontSize: 28 }}>🧩</Text>
          </View>
        )}
        <View style={{ height: '22%', alignItems: 'center', justifyContent: 'center', backgroundColor: '#F8FAFC' }}>
          <Text style={{ fontWeight: '700', color: '#1F2937' }} numberOfLines={1}>
            {tile.label}
          </Text>
        </View>
      </TouchableOpacity>
    </View>
  );
}

// -------------------- utils --------------------
function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

const menuStyles = StyleSheet.create({
  headerWrap: {
    alignItems: 'center',
    marginBottom: 28,
    marginTop: 16,
  },
  heroBadge: {
    width: 94,
    height: 94,
    borderRadius: 47,
    marginBottom: 14,
    shadowColor: '#3B82F6',
    shadowOpacity: 0.35,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 10,
  },
  heroGradient: {
    flex: 1,
    borderRadius: 47,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroTitle: {
    fontSize: 38,
    fontWeight: '800',
    color: '#0F172A',
    marginBottom: 6,
  },
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    marginTop: 4,
  },
  statChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 8,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  statText: {
    marginLeft: 6,
    fontWeight: '700',
    color: '#1F2937',
  },
  sectionHeading: {
    fontSize: 20,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 14,
    paddingHorizontal: 4,
  },
  gameCardWrapper: {
    width: '100%',
  },
  gameCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 26,
    padding: 22,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
    borderWidth: 1,
    borderColor: '#EEF2FF',
  },
  cardGlow: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: '65%',
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 18,
    gap: 16,
  },
  iconBadge: {
    width: 66,
    height: 66,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconEmoji: {
    fontSize: 34,
  },
  cardTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: '#0F172A',
    marginBottom: 4,
  },
  cardSubtitle: {
    fontSize: 14,
    color: '#4B5563',
    lineHeight: 20,
  },
  playBadge: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  progressBar: {
    height: 5,
    borderRadius: 999,
  },
  lockOverlay: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(15, 23, 42, 0.65)',
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
  },
  lockText: {
    color: '#FFFFFF',
    fontWeight: '700',
    textAlign: 'center',
    marginTop: 8,
  },
});
