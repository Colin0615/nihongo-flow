import React, { useState, useEffect, useRef, useMemo, useContext, createContext } from 'react';
import {
  Settings, Book, Brain, GraduationCap, Play, Volume2, X, RefreshCw,
  Briefcase, Coffee, AlertTriangle, Save, Search, CheckCircle, Clock, Camera,
  Pause, User, LogOut, Cloud, Globe, Mic
} from 'lucide-react';

// --- FIREBASE IMPORTS ---
import { initializeApp } from 'firebase/app';
import {
  getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword,
  signOut, onAuthStateChanged, signInWithCustomToken, signInAnonymously
} from 'firebase/auth';
import type { User as FirebaseUser } from 'firebase/auth';
import {
  getFirestore, doc, setDoc, getDoc, collection,
  query, where, getDocs, writeBatch
} from 'firebase/firestore';

// ==========================================
// 0. FIREBASE 配置
// ==========================================
const firebaseConfig = {
  apiKey: "AIzaSyBaBOohtvHu_NMWpDjqnJ2KdnY94HaEqCc",
  authDomain: "nihongo-flow-3c5bb.firebaseapp.com",
  projectId: "nihongo-flow-3c5bb",
  storageBucket: "nihongo-flow-3c5bb.firebasestorage.app",
  messagingSenderId: "194014511132",
  appId: "1:194014511132:web:3dde53e3f0b65209c11fd9",
  measurementId: "G-VKZELG9DBJ"
};

// 初始化 Firebase
let app, auth, db;
const appId = "nihongo-flow-saas";

try {
  if (firebaseConfig.apiKey) {
    app = initializeApp(firebaseConfig);
    auth = getAuth(app);
    db = getFirestore(app);
  } else {
    console.warn("Firebase 配置为空，运行在离线/本地演示模式");
  }
} catch (e) { console.error("Firebase init error:", e); }

// ==========================================
// 1. 类型定义与上下文
// ==========================================

type AIModelType = 'gemini' | 'openai';
type TTSProvider = 'browser' | 'google_cloud' | 'openai';
type JLPTLevel = 'N5' | 'N4' | 'N3' | 'N2' | 'N1';

interface AppSettings {
  geminiKey: string;
  openaiKey: string;
  googleTTSKey: string;
  selectedModel: AIModelType;
  ttsProvider: TTSProvider;
  userName: string;
}

// 默认设置
const DEFAULT_SETTINGS: AppSettings = { 
  geminiKey: '', 
  openaiKey: '', 
  googleTTSKey: '',
  selectedModel: 'gemini', 
  ttsProvider: 'browser',
  userName: 'Guest' 
};

// 创建 Settings Context
const SettingsContext = createContext<AppSettings>(DEFAULT_SETTINGS);

interface FuriganaSegment {
  text: string;
  furigana?: string;
}

interface KanaDetail {
  char: string;
  romaji: string;
  mnemonic: string;
  origin: string;
  examples: {
    lifestyle: { word: FuriganaSegment[]; meaning: string; sentence: FuriganaSegment[]; translation: string; };
    business: { word: FuriganaSegment[]; meaning: string; sentence: FuriganaSegment[]; translation: string; };
  }
}

interface VocabItem {
  word: FuriganaSegment[];
  reading: string;
  meaning: string;
  grammar_tag: string;
  example: {
    text: FuriganaSegment[];
    translation: string;
    grammar_point: string;
  };
}

interface GrammarItem {
  point: string;
  explanation: string;
  example: {
    text: FuriganaSegment[];
    translation: string;
  };
}

interface TextItem {
  role?: string;
  name?: string;
  text: FuriganaSegment[];
  translation: string;
}

interface CourseData {
  id: string;
  topic: string;
  level: JLPTLevel;
  title: FuriganaSegment[];
  vocabulary: VocabItem[];
  grammar: GrammarItem[];
  texts: {
    dialogue: TextItem[];
    essay: { title: string; content: TextItem[] };
  };
  createdAt: number;
}

interface SRSItem {
  id: string;
  type: 'vocab' | 'grammar';
  content: any;
  srs_level: number;
  next_review: number;
}

// ==========================================
// 2. 高级音频服务 (TTSService)
// ==========================================
class TTSService {
  private static audioCache = new Map<string, string>(); // 内存缓存
  private static currentAudio: HTMLAudioElement | null = null;

  static stop() {
    if (this.currentAudio) {
      this.currentAudio.pause();
      this.currentAudio = null;
    }
    window.speechSynthesis.cancel();
  }

  static async play(text: string, settings: AppSettings, onEnd?: () => void) {
    this.stop();

    const cacheKey = `${settings.ttsProvider}:${text}`;
    if (this.audioCache.has(cacheKey)) {
      this.playBlob(this.audioCache.get(cacheKey)!, onEnd);
      return;
    }

    try {
      let audioBlobUrl: string | null = null;

      if (settings.ttsProvider === 'google_cloud' && settings.googleTTSKey) {
        audioBlobUrl = await this.fetchGoogleCloudTTS(text, settings.googleTTSKey);
      } else if (settings.ttsProvider === 'openai' && settings.openaiKey) {
        audioBlobUrl = await this.fetchOpenAITTS(text, settings.openaiKey);
      }

      if (audioBlobUrl) {
        this.audioCache.set(cacheKey, audioBlobUrl);
        this.playBlob(audioBlobUrl, onEnd);
      } else {
        this.playBrowserTTS(text, onEnd);
      }

    } catch (error) {
      console.error("Cloud TTS failed, using browser fallback:", error);
      this.playBrowserTTS(text, onEnd);
    }
  }

  private static playBlob(url: string, onEnd?: () => void) {
    const audio = new Audio(url);
    this.currentAudio = audio;
    audio.onended = () => {
      this.currentAudio = null;
      onEnd?.();
    };
    audio.play().catch(e => {
      console.warn("Audio play failed:", e);
      onEnd?.();
    });
  }

  private static playBrowserTTS(text: string, onEnd?: () => void) {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'ja-JP';
    u.rate = 0.9;
    
    const voices = window.speechSynthesis.getVoices();
    const bestVoice = voices.find(v => v.lang.includes("ja") && (v.name.includes("Google") || v.name.includes("Microsoft"))) 
                   || voices.find(v => v.lang.includes("ja"));
    
    if (bestVoice) u.voice = bestVoice;
    
    u.onend = () => onEnd?.();
    u.onerror = (e) => {
      console.error("Browser TTS error:", e);
      onEnd?.();
    };
    window.speechSynthesis.speak(u);
  }

  private static async fetchGoogleCloudTTS(text: string, key: string): Promise<string> {
    const response = await fetch(`https://texttospeech.googleapis.com/v1/text:synthesize?key=${key}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        input: { text },
        voice: { languageCode: 'ja-JP', name: 'ja-JP-Neural2-B' },
        audioConfig: { audioEncoding: 'MP3' }
      })
    });

    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.error?.message || "Google TTS Error");
    }

    const data = await response.json();
    const binaryString = window.atob(data.audioContent);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    const blob = new Blob([bytes.buffer], { type: 'audio/mp3' });
    return URL.createObjectURL(blob);
  }

  private static async fetchOpenAITTS(text: string, key: string): Promise<string> {
    const response = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${key}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'tts-1',
        input: text,
        voice: 'nova'
      })
    });

    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.error?.message || "OpenAI TTS Error");
    }

    const blob = await response.blob();
    return URL.createObjectURL(blob);
  }
}

// ==========================================
// 3. 静态数据处理 (恢复完整数据 + 修复最后一行错误)
// ==========================================

const parseToSegments = (str: string): FuriganaSegment[] => {
  if (!str) return [];
  const regex = /([\u4e00-\u9fa5\u3005]+)(?:\[(.+?)\]|\((.+?)\))|([^\u4e00-\u9fa5\u3005\[\]\(\)]+)/g;
  const segments: FuriganaSegment[] = [];
  let match;
  let hasMatch = false;

  if (typeof str !== 'string') return str;

  while ((match = regex.exec(str)) !== null) {
    hasMatch = true;
    if (match[1]) {
      const text = match[1];
      const furigana = match[2] || match[3];
      const hasKanji = /[\u4e00-\u9fa5]/.test(text);
      if (hasKanji && furigana && furigana !== text) {
        segments.push({ text, furigana });
      } else {
        segments.push({ text });
      }
    } else if (match[4]) {
      segments.push({ text: match[4] });
    }
  }

  if (!hasMatch) {
    const simpleRegex = /(.+?)[（\(](.+?)[）\)]/g;
    if (simpleRegex.test(str)) {
      let lastIndex = 0;
      simpleRegex.lastIndex = 0;
      str.replace(simpleRegex, (m, text, furigana, offset) => {
        if (offset > lastIndex) segments.push({ text: str.substring(lastIndex, offset) });
        const hasKanji = /[\u4e00-\u9fa5]/.test(text);
        if (hasKanji && furigana !== text) {
          segments.push({ text, furigana });
        } else {
          segments.push({ text });
        }
        lastIndex = offset + m.length;
        return m;
      });
      if (lastIndex < str.length) segments.push({ text: str.substring(lastIndex) });
    } else {
      return [{ text: str }];
    }
  }
  return segments;
};

// 完整五十音图数据 (已确认 Wa 行修复)
const RAW_KANA_DATA = {
  hiragana: [
    { char: "あ", romaji: "a", origin: "安", mnemonic: "来源于汉字'安'的草书。", word_l: "朝 (あさ)", mean_l: "早晨", sent_l: "朝 (あさ) ごはんを 食 (た) べる。", trans_l: "吃早饭。", word_b: "挨拶 (あいさつ)", mean_b: "问候", sent_b: "挨拶 (あいさつ) を 交 (か) わす。", trans_b: "互相问候。" },
    { char: "い", romaji: "i", origin: "以", mnemonic: "来源于汉字'以'。", word_l: "家 (いえ)", mean_l: "家", sent_l: "家 (いえ) に 帰 (かえ) る。", trans_l: "回家。", word_b: "依頼 (いらい)", mean_b: "委托", sent_b: "仕事 (しごと) を 依頼 (いらい) する。", trans_b: "委托工作。" },
    { char: "う", romaji: "u", origin: "宇", mnemonic: "来源于汉字'宇'。", word_l: "海 (うみ)", mean_l: "海", sent_l: "海 (うみ) に 行 (い) く。", trans_l: "去海边。", word_b: "受付 (うけつけ)", mean_b: "接待处", sent_b: "受付 (うけつけ) で 聞 (き) く。", trans_b: "在接待处询问。" },
    { char: "え", romaji: "e", origin: "衣", mnemonic: "来源于汉字'衣'。", word_l: "駅 (えき)", mean_l: "车站", sent_l: "駅 (えき) で 待 (ま) つ。", trans_l: "在车站等。", word_b: "営業 (えいぎょう)", mean_b: "营业", sent_b: "営業 (えいぎょう) に 行 (い) く。", trans_b: "去跑业务。" },
    { char: "お", romaji: "o", origin: "於", mnemonic: "来源于汉字'於'。", word_l: "お金 (かね)", mean_l: "钱", sent_l: "お金 (かね) を 下 (お) ろす。", trans_l: "取钱。", word_b: "御社 (おんしゃ)", mean_b: "贵公司", sent_b: "御社 (おんしゃ) の 発展 (はってん) を 祈 (いの) る。", trans_b: "祝贵公司发展。" },
    { char: "か", romaji: "ka", origin: "加", mnemonic: "来源于汉字'加'。", word_l: "傘 (かさ)", mean_l: "伞", sent_l: "傘 (かさ) を 差 (さ) す。", trans_l: "打伞。", word_b: "会議 (かいぎ)", mean_b: "会议", sent_b: "会議 (かいぎ) に 出 (で) る。", trans_b: "出席会议。" },
    { char: "き", romaji: "ki", origin: "幾", mnemonic: "来源于汉字'幾'。", word_l: "木 (き)", mean_l: "树", sent_l: "木 (き) を 植 (う) える。", trans_l: "种树。", word_b: "企画 (きかく)", mean_b: "企划", sent_b: "企画書 (きかくしょ) を 作 (つく) る。", trans_b: "制作企划书。" },
    { char: "く", romaji: "ku", origin: "久", mnemonic: "来源于汉字'久'。", word_l: "靴 (くつ)", mean_l: "鞋", sent_l: "靴 (くつ) を 履 (は) く。", trans_l: "穿鞋。", word_b: "空港 (くうこう)", mean_b: "机场", sent_b: "空港 (くうこう) に 向 (む) かう。", trans_b: "前往机场。" },
    { char: "け", romaji: "ke", origin: "計", mnemonic: "来源于汉字'计'。", word_l: "景色 (けしき)", mean_l: "景色", sent_l: "景色 (けしき) が いい。", trans_l: "景色很好。", word_b: "契約 (けいやく)", mean_b: "合同", sent_b: "契約 (けいやく) を 結 (むす) ぶ。", trans_b: "签订合同。" },
    { char: "こ", romaji: "ko", origin: "己", mnemonic: "来源于汉字'己'。", word_l: "声 (こえ)", mean_l: "声音", sent_l: "声 (こえ) が 大 (おお) きい。", trans_l: "声音大。", word_b: "故障 (こしょう)", mean_b: "故障", sent_b: "機械 (きかい) が 故障 (こしょう) する。", trans_b: "机器故障。" },
    { char: "さ", romaji: "sa", origin: "左", mnemonic: "来源于汉字'左'。", word_l: "魚 (さかな)", mean_l: "鱼", sent_l: "魚 (さかな) を 焼 (や) く。", trans_l: "烤鱼。", word_b: "残業 (ざんぎょう)", mean_b: "加班", sent_b: "今日 (きょう) は 残業 (ざんぎょう) だ。", trans_b: "今天是加班。" },
    { char: "し", romaji: "shi", origin: "之", mnemonic: "来源于汉字'之'。", word_l: "塩 (しお)", mean_l: "盐", sent_l: "塩 (しお) を 振 (ふ) る。", trans_l: "撒盐。", word_b: "資料 (しりょう)", mean_b: "资料", sent_b: "資料 (しりょう) を 読 (よ) む。", trans_b: "阅读资料。" },
    { char: "す", romaji: "su", origin: "寸", mnemonic: "来源于汉字'寸'。", word_l: "寿司 (すし)", mean_l: "寿司", sent_l: "寿司 (すし) を 食 (た) べる。", trans_l: "吃寿司。", word_b: "スケジュール", mean_b: "日程", sent_b: "スケジュール を 確認 (かくにん) する。", trans_b: "确认日程。" },
    { char: "せ", romaji: "se", origin: "世", mnemonic: "来源于汉字'世'。", word_l: "背 (せ)", mean_l: "身高", sent_l: "背 (せ) が 高 (たか) い。", trans_l: "个子高。", word_b: "接待 (せったい)", mean_b: "接待", sent_b: "客 (きゃく) を 接待 (せったい) する。", trans_b: "接待客户。" },
    { char: "そ", romaji: "so", origin: "曽", mnemonic: "来源于汉字'曽'。", word_l: "空 (そら)", mean_l: "天空", sent_l: "空 (そら) が 青 (あお) い。", trans_l: "天很蓝。", word_b: "相談 (そうだん)", mean_b: "商量", sent_b: "上司 (じょうし) に 相談 (そうだん) する。", trans_b: "和上司商量。" },
    { char: "た", romaji: "ta", origin: "太", mnemonic: "来源于汉字'太'。", word_l: "卵 (たまご)", mean_l: "鸡蛋", sent_l: "卵 (たまご) を 割 (わ) る。", trans_l: "打鸡蛋。", word_b: "担当 (たんとう)", mean_b: "负责人", sent_b: "担当者 (たんとうしゃ) を 呼 (よ) ぶ。", trans_b: "叫负责人。" },
    { char: "ち", romaji: "chi", origin: "知", mnemonic: "来源于汉字'知'。", word_l: "地図 (ちず)", mean_l: "地图", sent_l: "地図 (ちず) を 見 (み) る。", trans_l: "看地图。", word_b: "遅刻 (ちこく)", mean_b: "迟到", sent_b: "会議 (かいぎ) に 遅刻 (ちこく) する。", trans_b: "会议迟到。" },
    { char: "つ", romaji: "tsu", origin: "川", mnemonic: "来源于汉字'川'。", word_l: "机 (つくえ)", mean_l: "桌子", sent_l: "机 (つくえ) に 向 (む) かう。", trans_l: "坐在桌前。", word_b: "通勤 (つうきん)", mean_b: "通勤", sent_b: "電車 (でんしゃ) で 通勤 (つうきん) する。", trans_b: "坐电车通勤。" },
    { char: "て", romaji: "te", origin: "天", mnemonic: "来源于汉字'天'。", word_l: "手 (て)", mean_l: "手", sent_l: "手 (て) を 洗 (あら) う。", trans_l: "洗手。", word_b: "手配 (てはい)", mean_b: "安排", sent_b: "チケット を 手配 (てはい) する。", trans_b: "安排票务。" },
    { char: "と", romaji: "to", origin: "止", mnemonic: "来源于汉字'止'。", word_l: "時計 (とけい)", mean_l: "钟表", sent_l: "時計 (とけい) を 見 (み) る。", trans_l: "看表。", word_b: "取引 (とりひき)", mean_b: "交易", sent_b: "取引先 (とりひきさき) と 会 (あ) う。", trans_b: "见交易伙伴。" },
    { char: "な", romaji: "na", origin: "奈", mnemonic: "来源于汉字'奈'。", word_l: "名前 (なまえ)", mean_l: "名字", sent_l: "名前 (なまえ) を 書 (か) く。", trans_l: "写名字。", word_b: "納品 (のうひん)", mean_b: "交货", sent_b: "商品 (しょうひん) を 納品 (のうひん) する。", trans_b: "交付商品。" },
    { char: "に", romaji: "ni", origin: "仁", mnemonic: "来源于汉字'仁'。", word_l: "肉 (にく)", mean_l: "肉", sent_l: "肉 (にく) を 焼 (や) く。", trans_l: "烤肉。", word_b: "日程 (にってい)", mean_b: "日程", sent_b: "日程 (にってい) を 決 (き) める。", trans_b: "定日程。" },
    { char: "ぬ", romaji: "nu", origin: "奴", mnemonic: "来源于汉字'奴'。", word_l: "布 (ぬの)", mean_l: "布", sent_l: "布 (ぬの) で 拭 (ふ) く。", trans_l: "用布擦。", word_b: "（特になし）", mean_b: "-", sent_b: "-", trans_b: "-" },
    { char: "ね", romaji: "ne", origin: "祢", mnemonic: "来源于汉字'祢'。", word_l: "猫 (ねこ)", mean_l: "猫", sent_l: "猫 (ねこ) が 鳴 (な) く。", trans_l: "猫叫。", word_b: "値引き (ねびき)", mean_b: "打折", sent_b: "値引き (ねびき) を 頼 (たの) む。", trans_b: "请求打折。" },
    { char: "の", romaji: "no", origin: "乃", mnemonic: "来源于汉字'乃'。", word_l: "飲み物 (のみもの)", mean_l: "饮料", sent_l: "飲み物 (のみもの) を 買 (か) う。", trans_l: "买饮料。", word_b: "納期 (のうき)", mean_b: "交货期", sent_b: "納期 (のうき) を 守 (まも) る。", trans_b: "遵守交期。" },
    // Ha 行
    { char: "は", romaji: "ha", origin: "波", mnemonic: "来源于汉字'波'。", word_l: "箸 (はし)", mean_l: "筷子", sent_l: "箸 (はし) を 使 (つか) う。", trans_l: "用筷子。", word_b: "販売 (はんばい)", mean_b: "销售", sent_b: "商品 (しょうひん) を 販売 (はんばい) する。", trans_b: "销售商品。" },
    { char: "ひ", romaji: "hi", origin: "比", mnemonic: "来源于汉字'比'。", word_l: "人 (ひと)", mean_l: "人", sent_l: "人 (ひと) が 多 (おお) い。", trans_l: "人很多。", word_b: "費用 (ひよう)", mean_b: "費用 (ひよう) が かかる。", trans_b: "花费费用。" },
    { char: "ふ", romaji: "fu", origin: "不", mnemonic: "来源于汉字'不'。", word_l: "冬 (ふゆ)", mean_l: "冬天", sent_l: "冬 (ふゆ) が 来 (く) る。", trans_l: "冬天来了。", word_b: "不況 (ふきょう)", mean_b: "不景气", sent_b: "不況 (ふきょう) が 続 (つづ) く。", trans_b: "萧条持续。" },
    { char: "へ", romaji: "he", origin: "部", mnemonic: "来源于汉字'部'。", word_l: "部屋 (へや)", mean_l: "房间", sent_l: "部屋 (へや) を 掃除 (そうじ) する。", trans_l: "打扫房间。", word_b: "弊社 (へいしゃ)", mean_b: "敝司", sent_b: "弊社 (へいしゃ) の 提案 (ていあん) です。", trans_b: "这是敝司的提案。" },
    { char: "ほ", romaji: "ho", origin: "保", mnemonic: "来源于汉字'保'。", word_l: "本 (ほん)", mean_l: "书", sent_l: "本 (ほん) を 読 (よ) む。", trans_l: "读书。", word_b: "報告 (ほうこく)", mean_b: "报告", sent_b: "結果 (けっか) を 報告 (ほうこく) する。", trans_b: "报告结果。" },
    // Ma 行
    { char: "ま", romaji: "ma", origin: "末", mnemonic: "来源于汉字'末'。", word_l: "窓 (まど)", mean_l: "窗户", sent_l: "窓 (まど) を 開 (あ) ける。", trans_l: "开窗。", word_b: "満席 (まんせき)", mean_b: "满座", sent_b: "会議室 (かいぎしつ) は 満席 (まんせき) だ。", trans_b: "会议室满了。" },
    { char: "み", romaji: "mi", origin: "美", mnemonic: "来源于汉字'美'。", word_l: "店 (みせ)", mean_l: "店", sent_l: "店 (みせ) に 入 (はい) る。", trans_l: "进店。", word_b: "見積もり (みつもり)", mean_b: "报价", sent_b: "見積もり (みつもり) を 出 (だ) す。", trans_b: "出报价单。" },
    { char: "む", romaji: "mu", origin: "武", mnemonic: "来源于汉字'武'。", word_l: "虫 (むし)", mean_l: "虫子", sent_l: "虫 (むし) が いる。", trans_l: "有虫子。", word_b: "無断 (むだん)", mean_b: "擅自", sent_b: "無断 (むだん) で 休 (やす) む。", trans_b: "擅自缺勤。" },
    { char: "め", romaji: "me", origin: "女", mnemonic: "来源于汉字'女'。", word_l: "目 (め)", mean_l: "眼睛", sent_l: "目 (め) が 痛 (いた) い。", trans_l: "眼睛痛。", word_b: "面接 (めんせつ)", mean_b: "面试", sent_b: "面接 (めんせつ) を 受 (う) ける。", trans_b: "接受面试。" },
    { char: "も", romaji: "mo", origin: "毛", mnemonic: "来源于汉字'毛'。", word_l: "森 (もり)", mean_l: "森林", sent_l: "森 (もり) を 歩 (ある) く。", trans_l: "走在森林。", word_b: "目標 (もくひょう)", mean_b: "目标", sent_b: "目標 (もくひょう) を 立 (た) てる。", trans_b: "设立目标。" },
    // Ya 行
    { char: "や", romaji: "ya", origin: "也", mnemonic: "来源于汉字'也'。", word_l: "山 (やま)", mean_l: "山", sent_l: "山 (やま) に 登 (のぼ) る。", trans_l: "爬山。", word_b: "約束 (やくそく)", mean_b: "约定", sent_b: "約束 (やくそく) を 守 (まも) る。", trans_b: "遵守约定。" },
    { char: "", romaji: "", mnemonic: "", origin: "", examples: { lifestyle: { word: [], meaning: "", sentence: [], translation: "" }, business: { word: [], meaning: "", sentence: [], translation: "" } } },
    { char: "ゆ", romaji: "yu", origin: "由", mnemonic: "来源于汉字'由'。", word_l: "雪 (ゆき)", mean_l: "雪", sent_l: "雪 (ゆき) が 降 (ふ) る。", trans_l: "下雪。", word_b: "輸出 (ゆしゅつ)", mean_b: "出口", sent_b: "製品 (せいひん) を 輸出 (ゆしゅつ) する。", trans_b: "出口产品。" },
    { char: "", romaji: "", mnemonic: "", origin: "", examples: { lifestyle: { word: [], meaning: "", sentence: [], translation: "" }, business: { word: [], meaning: "", sentence: [], translation: "" } } },
    { char: "よ", romaji: "yo", origin: "与", mnemonic: "来源于汉字'与'。", word_l: "夜 (よる)", mean_l: "夜晚", sent_l: "夜 (よる) が 明 (あ) ける。", trans_l: "天亮。", word_b: "予算 (よさん)", mean_b: "预算", sent_b: "予算 (よさん) を 組 (く) む。", trans_b: "做预算。" },
    { char: "ら", romaji: "ra", origin: "良", mnemonic: "来源于汉字'良'的右上。", word_l: "ラーメン", mean_l: "拉面", sent_l: "ラーメン を 食 (た) べる。", trans_l: "吃拉面。", word_b: "ランチ", mean_b: "午餐", sent_b: "ビジネス ランチ。", trans_b: "商务午餐。" },
    { char: "り", romaji: "ri", origin: "利", mnemonic: "来源于汉字'利'的右旁。", word_l: "りんご", mean_l: "苹果", sent_l: "りんご を 食 (た) べる。", trans_l: "吃苹果。", word_b: "利益 (りえき)", mean_b: "利益", sent_b: "利益 (りえき) を 上 (あ) げる。", trans_b: "提高利润。" },
    { char: "る", romaji: "ru", origin: "流", mnemonic: "来源于汉字'流'的右下。", word_l: "留守 (るす)", mean_l: "不在家", sent_l: "家 (いえ) は 留守 (るす) だ。", trans_l: "家里没人。", word_b: "ルール", mean_b: "规则", sent_b: "ルール を 守 (まも) る。", trans_b: "遵守规则。" },
    { char: "れ", romaji: "re", origin: "礼", mnemonic: "来源于汉字'礼'的右旁。", word_l: "冷蔵庫 (れいぞうこ)", mean_l: "冰箱", sent_l: "冷蔵庫 (れいぞうこ) に 入 (い) れる。", trans_l: "放入冰箱。", word_b: "連絡 (れんらく)", mean_b: "联系", sent_b: "後 (あと) で 連絡 (れんらく) する。", trans_b: "稍后联系。" },
    { char: "ろ", romaji: "ro", origin: "吕", mnemonic: "来源于汉字'吕'的上部。", word_l: "ろうそく", mean_l: "蜡烛", sent_l: "ろうそく を 消 (け) す。", trans_l: "吹灭蜡烛。", word_b: "労働 (ろうどう)", mean_b: "劳动", sent_b: "労働 (ろうどう) 時間 (じかん)。", trans_b: "劳动时间。" },
    // 修复 Wa 行 (之前混入了 Katakana)
    { char: "わ", romaji: "wa", origin: "和", mnemonic: "来源于汉字'和'的草书。", word_l: "私 (わたし)", mean_l: "我", sent_l: "私 (わたし) は 学生 (がくせい) です。", trans_l: "我是学生。", word_b: "話題 (わだい)", mean_b: "话题", sent_b: "話題 (わだい) を 変 (か) える。", trans_b: "换个话题。" },
    { char: "を", romaji: "wo", origin: "远", mnemonic: "来源于汉字'远'的草书。", word_l: "（助詞）", mean_l: "助词", sent_l: "本 (ほん) を 読 (よ) む。", trans_l: "读书。", word_b: "-", mean_b: "-", sent_b: "-", trans_b: "-" },
    { char: "ん", romaji: "n", origin: "无", mnemonic: "来源于汉字'无'的草书。", word_l: "本 (ほん)", mean_l: "书", sent_l: "これ は 本 (ほん) です。", trans_l: "这是一本书。", word_b: "案内 (あんない)", mean_b: "向导/指南", sent_b: "案内 (あんない) する。", trans_b: "带路/介绍。" }
  ],
  katakana: [
    { char: "ア", romaji: "a", origin: "阿", mnemonic: "来源于汉字'阿'的左耳旁。", word_l: "アイス", mean_l: "冰激凌", sent_l: "アイス を 食 (た) べる。", trans_l: "吃冰激凌。", word_b: "アイデア", mean_b: "主意", sent_b: "良 (い) い アイデア。", trans_b: "好主意。" },
    { char: "イ", romaji: "i", origin: "伊", mnemonic: "来源于汉字'伊'的单人旁。", word_l: "インク", mean_l: "墨水", sent_l: "インク が ない。", trans_l: "没墨水了。", word_b: "イベント", mean_b: "活动", sent_b: "イベント を 開 (ひら) く。", trans_b: "举办活动。" },
    { char: "ウ", romaji: "u", origin: "宇", mnemonic: "来源于汉字'宇'的宝盖头。", word_l: "ウイルス", mean_l: "病毒", sent_l: "ウイルス 注意 (ちゅうい)。", trans_l: "注意病毒。", word_b: "ウェブ", mean_b: "网络", sent_b: "ウェブ 会議 (かいぎ)。", trans_b: "网络会议。" },
    { char: "エ", romaji: "e", origin: "江", mnemonic: "来源于汉字'江'的工字旁。", word_l: "エアコン", mean_l: "空调", sent_l: "エアコン を つける。", trans_l: "开空调。", word_b: "エラー", mean_b: "错误", sent_b: "エラー が 出 (で) た。", trans_b: "出错了。" },
    { char: "オ", romaji: "o", origin: "於", mnemonic: "来源于汉字'於'的方字旁。", word_l: "オートバイ", mean_l: "摩托车", sent_l: "オートバイ に 乗 (の) る。", trans_l: "骑摩托。", word_b: "オフィス", mean_b: "办公室", sent_b: "オフィス に 行 (い) く。", trans_b: "去办公室。" },
    // Ka 行
    { char: "カ", romaji: "ka", origin: "加", mnemonic: "来源于汉字'加'的左旁。", word_l: "カメラ", mean_l: "相机", sent_l: "カメラ で 撮 (と) る。", trans_l: "用相机拍。", word_b: "カット", mean_b: "削减", sent_b: "コスト を カット する。", trans_b: "削减成本。" },
    { char: "キ", romaji: "ki", origin: "幾", mnemonic: "来源于汉字'幾'的上半部。", word_l: "キー", mean_l: "钥匙", sent_l: "キー を なくした。", trans_l: "钥匙丢了。", word_b: "キャンセル", mean_b: "取消", sent_b: "予約 (よやく) を キャンセル する。", trans_b: "取消预约。" },
    { char: "ク", romaji: "ku", origin: "久", mnemonic: "来源于汉字'久'的左上。", word_l: "クラス", mean_l: "班级", sent_l: "クラス の 友達 (ともだち)。", trans_l: "班级朋友。", word_b: "クレーム", mean_b: "投诉", sent_b: "クレーム 対応 (たいおう)。", trans_b: "投诉处理。" },
    { char: "ケ", romaji: "ke", origin: "介", mnemonic: "来源于汉字'介'。", word_l: "ケーキ", mean_l: "蛋糕", sent_l: "ケーキ を 食 (た) べる。", trans_l: "吃蛋糕。", word_b: "ケース", mean_b: "案例", sent_b: "ケーススタディ。", trans_b: "案例分析。" },
    { char: "コ", romaji: "ko", origin: "己", mnemonic: "来源于汉字'己'的上半部。", word_l: "コート", mean_l: "大衣", sent_l: "コート を 着 (き) る。", trans_l: "穿大衣。", word_b: "コピー", mean_b: "复印", sent_b: "資料 (しりょう) を コピー する。", trans_b: "复印资料。" },
    // Sa 行
    { char: "サ", romaji: "sa", origin: "散", mnemonic: "来源于汉字'散'的左上。", word_l: "サイン", mean_l: "签名", sent_l: "サイン を お願 (ねが) いします。", trans_l: "请签名。", word_b: "サービス", mean_b: "服务", sent_b: "サービス が 良 (い) い。", trans_b: "服务好。" },
    { char: "シ", romaji: "shi", origin: "之", mnemonic: "来源于汉字'之'的变形。", word_l: "シャツ", mean_l: "衬衫", sent_l: "白 (しろ) い シャツ。", trans_l: "白衬衫。", word_b: "システム", mean_b: "系统", sent_b: "システム を 導入 (どうにゅう) する。", trans_b: "导入系统。" },
    { char: "ス", romaji: "su", origin: "须", mnemonic: "来源于汉字'须'的右旁。", word_l: "スーツ", mean_l: "西装", sent_l: "スーツ を 着 (き) る。", trans_l: "穿西装。", word_b: "スケジュール", mean_b: "日程", sent_b: "スケジュール 管理 (かんり)。", trans_b: "日程管理。" },
    { char: "セ", romaji: "se", origin: "世", mnemonic: "来源于汉字'世'。", word_l: "セット", mean_l: "套餐", sent_l: "ランチ セット。", trans_l: "午餐套餐。", word_b: "セールス", mean_b: "推销", sent_b: "セールス ポイント。", trans_b: "卖点。" },
    { char: "ソ", romaji: "so", origin: "曽", mnemonic: "来源于汉字'曽'的上部。", word_l: "ソース", mean_l: "酱汁", sent_l: "ソース を かける。", trans_l: "淋上酱汁。", word_b: "ソフト", mean_b: "软件", sent_b: "会計 (かいけい) ソフト。", trans_b: "会计软件。" },
    // Ta 行
    { char: "タ", romaji: "ta", origin: "多", mnemonic: "来源于汉字'多'的上半部。", word_l: "タオル", mean_l: "毛巾", sent_l: "タオル で 拭 (ふ) く。", trans_l: "用毛巾擦。", word_b: "タイプ", mean_b: "类型", sent_b: "新 (あたら) しい タイプ。", trans_b: "新型。" },
    { char: "チ", romaji: "chi", origin: "千", mnemonic: "来源于汉字'千'。", word_l: "チーム", mean_l: "团队", sent_l: "チーム で 働 (はたら) く。", trans_l: "团队合作。", word_b: "チェック", mean_b: "检查", sent_b: "書類 (しょるい) を チェック する。", trans_b: "检查文件。" },
    { char: "ツ", romaji: "tsu", origin: "川", mnemonic: "来源于汉字'川'。", word_l: "ツアー", mean_l: "旅行团", sent_l: "ツアー に 参加 (さんか) する。", trans_l: "参加旅行团。", word_b: "ツール", mean_b: "工具", sent_b: "便利 (べんり) な ツール。", trans_b: "便利的工具。" },
    { char: "テ", romaji: "te", origin: "天", mnemonic: "来源于汉字'天'。", word_l: "テスト", mean_l: "考试", sent_l: "テスト を 受 (う) ける。", trans_l: "参加考试。", word_b: "テーマ", mean_b: "主题", sent_b: "会議 (かいぎ) の テーマ。", trans_b: "会议主题。" },
    { char: "ト", romaji: "to", origin: "止", mnemonic: "来源于汉字'止'的右上。", word_l: "トイレ", mean_l: "厕所", sent_l: "トイレ は どこ ですか。", trans_l: "厕所在哪。", word_b: "トラブル", mean_b: "麻烦", sent_b: "トラブル が 起 (お) きる。", trans_b: "发生麻烦。" },
    // Na 行
    { char: "ナ", romaji: "na", origin: "奈", mnemonic: "来源于汉字'奈'的左上。", word_l: "ナイフ", mean_l: "刀", sent_l: "ナイフ と フォーク", trans_l: "刀叉", word_b: "ナンバー", mean_b: "号码", sent_b: "会員 (かいいん) ナンバー。", trans_b: "会员号。" },
    { char: "ニ", romaji: "ni", origin: "仁", mnemonic: "来源于汉字'仁'的右旁。", word_l: "ニュース", mean_l: "新闻", sent_l: "ニュース を 見 (み) る。", trans_l: "看新闻。", word_b: "ニーズ", mean_b: "需求", sent_b: "顧客 (こきゃく) の ニーズ。", trans_b: "客户需求。" },
    { char: "ヌ", romaji: "nu", origin: "奴", mnemonic: "来源于汉字'奴'的右旁。", word_l: "ヌードル", mean_l: "面条", sent_l: "カップ ヌードル。", trans_l: "杯面。", word_b: "（特になし）", mean_b: "-", sent_b: "-", trans_b: "-" },
    { char: "ネ", romaji: "ne", origin: "祢", mnemonic: "来源于汉字'祢'的左旁。", word_l: "ネクタイ", mean_l: "领带", sent_l: "ネクタイ を 締 (し) める。", trans_l: "系领带。", word_b: "ネットワーク", mean_b: "网络", sent_b: "社内 (しゃない) ネットワーク。", trans_b: "公司内部网。" },
    { char: "ノ", romaji: "no", origin: "乃", mnemonic: "来源于汉字'乃'的左部。", word_l: "ノート", mean_l: "笔记本", sent_l: "ノート に 書 (か) く。", trans_l: "写在笔记本上。", word_b: "ノルマ", mean_b: "定额", sent_b: "ノルマ を 達成 (たっせい) する。", trans_b: "达成定额。" },
    // Ha 行
    { char: "ハ", romaji: "ha", origin: "八", mnemonic: "来源于汉字'八'。", word_l: "ハンバーガー", mean_l: "汉堡", sent_l: "ハンバーガー を 食 (た) べる。", trans_l: "吃汉堡。", word_b: "ハードル", mean_b: "障碍", sent_b: "高 (たか) い ハードル。", trans_b: "高门槛。" },
    { char: "ヒ", romaji: "hi", origin: "比", mnemonic: "来源于汉字'比'的右旁。", word_l: "ヒーター", mean_l: "取暖器", sent_l: "ヒーター を つける。", trans_l: "开取暖器。", word_b: "ヒット", mean_b: "热销", sent_b: "大 (だい) ヒット 商品 (しょうひん)。", trans_b: "大热商品。" },
    { char: "フ", romaji: "fu", origin: "不", mnemonic: "来源于汉字'不'的首二笔。", word_l: "フォーク", mean_l: "叉子", sent_l: "フォーク を 使 (つか) う。", trans_l: "用叉子。", word_b: "ファイル", mean_b: "文件", sent_b: "ファイル を 保存 (ほぞん) する。", trans_b: "保存文件。" },
    { char: "ヘ", romaji: "he", origin: "部", mnemonic: "来源于汉字'部'的右旁。", word_l: "ヘルメット", mean_l: "头盔", sent_l: "ヘルメット を かぶる。", trans_l: "戴头盔。", word_b: "ヘルプ", mean_b: "帮助", sent_b: "ヘルプ を 求 (もと) める。", trans_b: "寻求帮助。" },
    { char: "ホ", romaji: "ho", origin: "保", mnemonic: "来源于汉字'保'的右下。", word_l: "ホテル", mean_l: "酒店", sent_l: "ホテル に 泊 (と) まる。", trans_l: "住酒店。", word_b: "ホームページ", mean_b: "主页", sent_b: "会社 (かいしゃ) の ホームページ。", trans_b: "公司主页。" },
    // Ma 行
    { char: "マ", romaji: "ma", origin: "末", mnemonic: "来源于汉字'末'的首二笔。", word_l: "マスク", mean_l: "口罩", sent_l: "マスク を する。", trans_l: "戴口罩。", word_b: "マナー", mean_b: "礼仪", sent_b: "ビジネス マナー。", trans_b: "商务礼仪。" },
    { char: "ミ", romaji: "mi", origin: "三", mnemonic: "来源于汉字'三'。", word_l: "ミルク", mean_l: "牛奶", sent_l: "ミルク を 飲 (の) む。", trans_l: "喝牛奶。", word_b: "ミス", mean_b: "失误", sent_b: "ミス を 防 (ふせ) ぐ。", trans_b: "防止失误。" },
    { char: "ム", romaji: "mu", origin: "牟", mnemonic: "来源于汉字'牟'的上部。", word_l: "ムード", mean_l: "气氛", sent_l: "良 (い) い ムード。", trans_l: "好气氛。", word_b: "ムダ", mean_b: "浪费", sent_b: "ムダ を 省 (はぶ) く。", trans_b: "省去浪费。" },
    { char: "メ", romaji: "me", origin: "女", mnemonic: "来源于汉字'女'的下部。", word_l: "メニュー", mean_l: "菜单", sent_l: "メニュー を 見 (み) る。", trans_l: "看菜单。", word_b: "メール", mean_b: "邮件", sent_b: "メール を 送 (おく) る。", trans_b: "发邮件。" },
    { char: "モ", romaji: "mo", origin: "毛", mnemonic: "来源于汉字'毛'。", word_l: "モデル", mean_l: "模特", sent_l: "ファッション モデル。", trans_l: "时装模特。", word_b: "モニター", mean_b: "显示器", sent_b: "モニター を 見 (み) る。", trans_b: "看显示器。" },
    // Ya 行
    { char: "ヤ", romaji: "ya", origin: "也", mnemonic: "来源于汉字'也'。", word_l: "ヤング", mean_l: "年轻", sent_l: "ヤング 世代 (せだい)。", trans_l: "年轻一代。", word_b: "（特になし）", mean_b: "-", sent_b: "-", trans_b: "-" },
    { char: "", romaji: "", mnemonic: "", origin: "", examples: { lifestyle: { word: [], meaning: "", sentence: [], translation: "" }, business: { word: [], meaning: "", sentence: [], translation: "" } } },
    { char: "ユ", romaji: "yu", origin: "由", mnemonic: "来源于汉字'由'的下部。", word_l: "ユーザー", mean_l: "用户", sent_l: "ユーザー 登録 (とうろく)。", trans_l: "用户注册。", word_b: "ユニーク", mean_b: "独特", sent_b: "ユニーク な 発想 (はっそう)。", trans_b: "独特的想法。" },
    { char: "", romaji: "", mnemonic: "", origin: "", examples: { lifestyle: { word: [], meaning: "", sentence: [], translation: "" }, business: { word: [], meaning: "", sentence: [], translation: "" } } },
    { char: "ヨ", romaji: "yo", origin: "与", mnemonic: "来源于汉字'与'。", word_l: "ヨーロッパ", mean_l: "欧洲", sent_l: "ヨーロッパ 旅行 (りょこう)。", trans_l: "欧洲旅行。", word_b: "ヨット", mean_b: "游艇", sent_b: "ヨット に 乗 (の) る。", trans_b: "坐游艇。" },
    // Ra 行
    { char: "ラ", romaji: "ra", origin: "良", mnemonic: "来源于汉字'良'的右上。", word_l: "ラーメン", mean_l: "拉面", sent_l: "ラーメン を 食 (た) べる。", trans_l: "吃拉面。", word_b: "ランチ", mean_b: "午餐", sent_b: "ビジネス ランチ。", trans_b: "商务午餐。" },
    { char: "リ", romaji: "ri", origin: "利", mnemonic: "来源于汉字'利'的右旁。", word_l: "リボン", mean_l: "丝带", sent_l: "リボン を 結 (むす) ぶ。", trans_l: "系丝带。", word_b: "リスト", mean_b: "清单", sent_b: "リスト を 作 (つく) る。", trans_b: "制作清单。" },
    { char: "ル", romaji: "ru", origin: "流", mnemonic: "来源于汉字'流'的右下。", word_l: "ルール", mean_l: "规则", sent_l: "ルール を 守 (まも) る。", trans_l: "遵守规则。", word_b: "ルート", mean_b: "路线", sent_b: "営業 (えいぎょう) ルート。", trans_b: "销售路线。" },
    { char: "レ", romaji: "re", origin: "礼", mnemonic: "来源于汉字'礼'的右旁。", word_l: "レストラン", mean_l: "餐厅", sent_l: "レストラン で 食事 (しょくじ)。", trans_l: "在餐厅吃饭。", word_b: "レベル", mean_b: "水平", sent_b: "レベル を 上 (あ) げる。", trans_b: "提高水平。" },
    { char: "ロ", romaji: "ro", origin: "吕", mnemonic: "来源于汉字'吕'的上部。", word_l: "ロボット", mean_l: "机器人", sent_l: "ロボット を 作 (つく) る。", trans_l: "制作机器人。", word_b: "ロビー", mean_b: "大厅", sent_b: "ロビー で 待 (ま) つ。", trans_b: "在大厅等。" },
    // Wa 行
    { char: "ワ", romaji: "wa", origin: "和", mnemonic: "来源于汉字'和'的右旁。", word_l: "ワイン", mean_l: "红酒", sent_l: "ワイン を 飲 (の) む。", trans_l: "喝红酒。", word_b: "ワープロ", mean_b: "文字处理机", sent_b: "（死語）", trans_b: "-" },
    { char: "ヲ", romaji: "wo", origin: "乎", mnemonic: "来源于汉字'乎'。", word_l: "（助詞）", mean_l: "助词", sent_l: "-", trans_l: "-", word_b: "-", mean_b: "-", sent_b: "-", trans_b: "-" },
    { char: "ン", romaji: "n", origin: "尔", mnemonic: "来源于汉字'尔'。", word_l: "パンツ", mean_l: "裤子", sent_l: "パンツ を 履 (は) く。", trans_l: "穿裤子。", word_b: "サイン", mean_b: "签名", sent_b: "サイン を する。", trans_b: "签名。" }
  ]
};

const getKanaList = (type: 'hiragana' | 'katakana'): KanaDetail[] => {
  const source = type === 'hiragana' ? RAW_KANA_DATA.hiragana : RAW_KANA_DATA.katakana;
  return source.map(item => ({
    char: item.char,
    romaji: item.romaji,
    mnemonic: item.mnemonic,
    origin: item.origin,
    examples: {
      lifestyle: { word: parseToSegments(item.word_l), meaning: item.mean_l, sentence: parseToSegments(item.sent_l), translation: item.trans_l },
      business: { word: parseToSegments(item.word_b), meaning: item.mean_b, sentence: parseToSegments(item.sent_b), translation: item.trans_b }
    }
  }));
};

// ==========================================
// 3. 服务层 (Services) - 双模数据库适配器
// ==========================================

// --- 本地存储 (Fallback) ---
class LocalStorageManager {
  static getSettings(): AppSettings {
    try {
      const stored = localStorage.getItem('nihongo_app_settings');
      return stored ? { ...DEFAULT_SETTINGS, ...JSON.parse(stored) } : DEFAULT_SETTINGS;
    } catch { return DEFAULT_SETTINGS; }
  }
  static saveSettings(s: AppSettings) { localStorage.setItem('nihongo_app_settings', JSON.stringify(s)); }

  static getDB() {
    try { return JSON.parse(localStorage.getItem('nihongo_app_db') || '{"courses":[], "srsItems":[]}'); }
    catch { return { courses: [], srsItems: [] }; }
  }
  static saveDB(db: any) { localStorage.setItem('nihongo_app_db', JSON.stringify(db)); }
}

// --- 数据库适配器 ---
class DBAdapter {
  static async loadSettings(user: FirebaseUser | null): Promise<AppSettings> {
    let settings = LocalStorageManager.getSettings();
    if (user && db) {
      try {
        const docRef = doc(db, 'users', user.uid, 'settings', 'general');
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
          const cloudSettings = docSnap.data() as AppSettings;
          settings = { ...settings, ...cloudSettings };
          LocalStorageManager.saveSettings(settings);
        }
      } catch (e) { console.error("Sync fetch failed", e); }
    }
    return settings;
  }

  static async saveSettings(user: FirebaseUser | null, settings: AppSettings) {
    LocalStorageManager.saveSettings(settings);
    if (user && db) {
      try {
        await setDoc(doc(db, 'users', user.uid, 'settings', 'general'), settings);
      } catch (e) { console.error("Cloud save failed", e); }
    }
  }

  static async archiveCourse(user: FirebaseUser | null, course: CourseData) {
    if (!user) {
      const localDB = LocalStorageManager.getDB();
      if (!localDB.courses.find(c => c.id === course.id)) {
        localDB.courses.push(course);
        course.vocabulary.forEach((vocab, idx) => {
          localDB.srsItems.push({
            id: `vocab-${course.id}-${idx}`, type: 'vocab', content: vocab, srs_level: 0, next_review: Date.now()
          });
        });
        LocalStorageManager.saveDB(localDB);
      }
    } else if (db) {
      const batch = writeBatch(db);
      const courseRef = doc(db, 'users', user.uid, 'courses', course.id);
      batch.set(courseRef, course);
      course.vocabulary.forEach((vocab, idx) => {
        const itemId = `vocab-${course.id}-${idx}`;
        const itemRef = doc(db, 'users', user.uid, 'srs_items', itemId);
        const srsItem: SRSItem = {
          id: itemId, type: 'vocab', content: vocab, srs_level: 0, next_review: Date.now()
        };
        batch.set(itemRef, srsItem);
      });
      await batch.commit();
    }
  }

  static async getReviewQueue(user: FirebaseUser | null): Promise<SRSItem[]> {
    const now = Date.now();
    if (!user) {
      const localDB = LocalStorageManager.getDB();
      return localDB.srsItems.filter(item => item.next_review <= now);
    } else if (db) {
      const q = query(collection(db, 'users', user.uid, 'srs_items'), where("next_review", "<=", now));
      const querySnapshot = await getDocs(q);
      const items: SRSItem[] = [];
      querySnapshot.forEach((doc) => items.push(doc.data() as SRSItem));
      return items;
    }
    return [];
  }

  static async updateSRS(user: FirebaseUser | null, item: SRSItem, quality: 'hard' | 'good' | 'easy') {
    const intervals = [0, 1, 3, 7, 14, 30];
    if (quality === 'hard') item.srs_level = Math.max(0, item.srs_level - 1);
    else if (quality === 'good') item.srs_level = Math.min(5, item.srs_level + 1);
    else if (quality === 'easy') item.srs_level = Math.min(5, item.srs_level + 2);
    item.next_review = Date.now() + (intervals[item.srs_level] * 86400000);

    if (!user) {
      const localDB = LocalStorageManager.getDB();
      const idx = localDB.srsItems.findIndex(i => i.id === item.id);
      if (idx !== -1) {
        localDB.srsItems[idx] = item;
        LocalStorageManager.saveDB(localDB);
      }
    } else if (db) {
      await setDoc(doc(db, 'users', user.uid, 'srs_items', item.id), item, { merge: true });
    }
  }
}

// --- AI 服务 ---
class AIService {
  private static LEVEL_CONFIG = {
    N5: { vocab: 15, grammar: 3, dialogue: 8, essay: 10 },
    N4: { vocab: 20, grammar: 3, dialogue: 10, essay: 12 },
    N3: { vocab: 30, grammar: 5, dialogue: 15, essay: 15 },
    N2: { vocab: 40, grammar: 6, dialogue: 20, essay: 20 },
    N1: { vocab: 50, grammar: 8, dialogue: 25, essay: 25 }
  };

  private static COURSE_PROMPT = `
ADDITIONAL CONSTRAINTS AND QUALITY RULES (MUST FOLLOW):

1) Output MUST be strict valid JSON (RFC 8259). Do NOT include comments, markdown, or any extra text.
2) Do NOT omit, rename, or restructure any field defined in the JSON Structure.
3) All array items MUST include a stable "id" field (string, e.g. "vocab_001", "grammar_001", "dlg_001").
4) All Japanese text MUST strictly follow the Furigana Segment format:
   {"text":"漢字","furigana":"かんじ"}.
   Kana-only words must still use this structure.
5) Use SIMPLIFIED CHINESE ONLY for all meanings, explanations, translations, and grammar analysis.
6) grammar_tag MUST be one of the following values ONLY:
   noun, verb, adjective-i, adjective-na, particle, expression.
7) In example.grammar_point, explanations MUST be concise teaching-oriented sentences separated by "；",
   and must clearly explain verb forms, particles, or sentence structure.
8) Ensure all vocabulary, grammar points, dialogues, and texts are directly relevant to the given topic.
9) TARGET LEVEL INSTRUCTION:
   [LEVEL_INSTRUCTION]
10) If any content is uncertain, output null instead of guessing.
11) Ensure internal consistency: furigana must correctly match the kanji; translations must match the Japanese meaning.
12) REQUIRED ITEM COUNTS:
   - Vocabulary: [VOCAB_COUNT] items
   - Grammar: [GRAMMAR_COUNT] items
   - Dialogue: [DIALOGUE_COUNT] lines
   - Essay: [ESSAY_COUNT] sentences
13) CRITICAL: Escape all double quotes within strings with backslash.

JSON Structure:
{
  "topic": "Topic Name (Japanese)",
  "title": [FuriganaSegment...],
  "vocabulary": [ // [VOCAB_COUNT] items
    {
      "id": "v1", "word": [...], "reading": "hiragana", "meaning": "chinese", "grammar_tag": "noun",
      "example": { "text": [...], "translation": "chinese", "grammar_point": "Detailed chinese grammar analysis (verb forms, particles)" }
    }
  ],
  "grammar": [ // [GRAMMAR_COUNT] items
    { "id": "g1", "point": "...", "explanation": "chinese", "example": { "text": [...], "translation": "chinese" } }
  ],
  "texts": {
    "dialogue": [ // [DIALOGUE_COUNT] lines
      { "id": "d1", "role": "A", "name": "...", "text": [...], "translation": "chinese" }
    ],
    "essay": {
      "title": "...",
      "content": [ // [ESSAY_COUNT] sentences
        { "id": "e1", "text": [...], "translation": "chinese" }
      ]
    }
  }
}
`;

  // 2. Gemini 增强 Prompt (修复语法例句缺失问题)
  private static GEMINI_COURSE_PROMPT = `
Role: Expert Japanese JLPT [LEVEL] Instructor.
Task: Create a deep, high-quality, EXTENSIVE study session about: [TOPIC].

INSTRUCTIONS:
1. **Depth**: Do not be brief. Use the large token window to provide detailed explanations for every grammar point and vocabulary nuance.
2. **Vocabulary**: Select [VOCAB_COUNT] items. For each, 'grammar_point' MUST explain usage, nuance, or connection rules in detail (Simplified Chinese).
3. **Grammar**: Select [GRAMMAR_COUNT] points. Explain connection rules (e.g., Verb-Te + ...) clearly. 
   CRITICAL: Grammar examples must include Japanese text segments.
4. **Dialogue**: Create a [DIALOGUE_COUNT] line natural conversation using the target vocab/grammar.
5. **Essay**: Write a [ESSAY_COUNT] sentence reading passage.

Output strictly valid JSON (RFC 8259). No markdown.
Structure:
{
  "topic": "...",
  "title": [{"text":"...","furigana":"..."}],
  "vocabulary": [
    { "id": "v1", "word": [{"text":"...","furigana":"..."}], "reading": "...", "meaning": "...", "grammar_tag": "...", "example": { "text": [{"text":"...","furigana":"..."}], "translation": "...", "grammar_point": "..." } }
  ],
  "grammar": [
    { "id": "g1", "point": "...", "explanation": "...", "example": { "text": [{"text":"例","furigana":"れい"}], "translation": "..." } }
  ],
  "texts": {
    "dialogue": [ { "id": "d1", "role": "A", "name": "...", "text": [...], "translation": "..." } ],
    "essay": { "title": "...", "content": [ { "id": "e1", "text": [...], "translation": "..." } ] }
  }
}
`;

  private static DICT_PROMPT = `
Explain word/phrase. Output JSON.
CRITICAL: Use SIMPLIFIED CHINESE. NO ENGLISH.
Structure:
{
  "word": [{"text":"word","furigana":"kana"}],
  "reading": "hiragana",
  "meaning": "chinese",
  "grammar_tag": "part of speech",
  "example": { "text": [{"text":"...","furigana":"..."}], "translation": "chinese", "grammar_point": "Detailed grammar analysis in Chinese" }
}
`;

  private static VISION_PROMPT = `
Identify main object. Output JSON in Japanese.
CRITICAL: Use SIMPLIFIED CHINESE.
Structure:
{
  "word": [{"text":"word","furigana":"kana"}],
  "reading": "hiragana",
  "meaning": "chinese",
  "grammar_tag": "noun",
  "example": { "text": [{"text":"...","furigana":"..."}], "translation": "chinese", "grammar_point": "usage note" }
}
`;

  // Helper to extract JSON from potentially Markdown-wrapped response
  private static extractJSON(text: string): string {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start === -1 || end === -1) return text;
    return text.substring(start, end + 1);
  }

  private static parseJSONSafe(text: string): any {
    const extracted = this.extractJSON(text)
      .replace(/\u00a0/g, ' ')
      .replace(/,\s*([}\]])/g, '$1');
    return JSON.parse(extracted);
  }

  private static normalizeSegment(segment: FuriganaSegment): FuriganaSegment {
    const hasKanji = /[\u4e00-\u9fa5]/.test(segment.text);
    if (!hasKanji || segment.furigana === segment.text) {
      return { text: segment.text };
    }
    return segment;
  }

  private static normalizeSegments(segments: FuriganaSegment[]): FuriganaSegment[] {
    if (!Array.isArray(segments)) return [];
    return segments.map(seg => AIService.normalizeSegment(seg));
  }

  private static normalizeVocabItem(item: VocabItem): VocabItem {
    return {
      ...item,
      word: AIService.normalizeSegments(item.word),
      example: {
        ...item.example,
        text: AIService.normalizeSegments(item.example?.text || [])
      }
    };
  }

  private static normalizeGrammarItem(item: GrammarItem): GrammarItem {
    return {
      ...item,
      example: {
        ...item.example,
        text: AIService.normalizeSegments(item.example?.text || [])
      }
    };
  }

  private static normalizeTextItem(item: TextItem): TextItem {
    return {
      ...item,
      text: AIService.normalizeSegments(item.text)
    };
  }

  private static normalizeCourse(course: CourseData): CourseData {
    return {
      ...course,
      title: AIService.normalizeSegments(course.title),
      vocabulary: course.vocabulary.map(item => AIService.normalizeVocabItem(item)),
      grammar: course.grammar.map(item => AIService.normalizeGrammarItem(item)),
      texts: {
        ...course.texts,
        dialogue: course.texts.dialogue.map(item => AIService.normalizeTextItem(item)),
        essay: {
          ...course.texts.essay,
          content: course.texts.essay.content.map(item => AIService.normalizeTextItem(item))
        }
      }
    };
  }


  private static async requestGemini(prompt: string, settings: AppSettings, imageData?: string): Promise<string> {
    if (!settings.geminiKey) throw new Error("缺少 Gemini Key");
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${settings.geminiKey}`;
    const parts: any[] = [{ text: prompt }];
    if (imageData) parts.push({ inlineData: { mimeType: "image/jpeg", data: imageData } });

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts }],
        generationConfig: { 
          maxOutputTokens: 40000, 
          temperature: 0.7,
          responseMimeType: "application/json" 
        }
      })
    });

    const data = await res.json();
    if (data.error) throw new Error(`Gemini Error: ${data.error.message}`);
    return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  }

  static async callGemini(prompt: string, settings: AppSettings, imageData?: string): Promise<any> {
    const text = await this.requestGemini(prompt, settings, imageData);
    try {
      // 核心修复：移除 extractJSON，直接解析纯净 JSON
      return JSON.parse(text); 
    } catch (error) {
      console.warn("Gemini JSON parse error", error);
      // 如果解析失败（极少数情况），再尝试用 extractJSON 抢救一下
      try {
        return this.parseJSONSafe(text);
      } catch (retryError) {
         throw new Error("课程生成失败 (JSON解析错误)。请重试。");
      }
    }
  }

  static async callOpenAI(prompt: string, settings: AppSettings, imageData?: string): Promise<any> {
    if (!settings.openaiKey) throw new Error("缺少 OpenAI Key");
    const messages: any[] = [{ role: "system", content: "You are an expert Japanese JLPT Instructor. Output strict valid JSON." }];
    if (imageData) {
      messages.push({ role: "user", content: [{ type: "text", text: prompt }, { type: "image_url", image_url: { url: `data:image/jpeg;base64,${imageData}` } }] });
    } else {
      messages.push({ role: "user", content: prompt });
    }

    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${settings.openaiKey}` },
      body: JSON.stringify({ model: "gpt-5.2-2025-12-11", response_format: { type: "json_object" }, messages })
    });
    const data = await res.json();
    if (data.error) throw new Error(`OpenAI Error: ${data.error.message}`);
    // GPT 依然需要 extractJSON，因为它可能包含 markdown wrapper
    return this.parseJSONSafe(data.choices?.[0]?.message?.content || '{}');
  }

  static async generateCourse(topic: string, level: JLPTLevel, settings: AppSettings): Promise<CourseData> {
    const config = AIService.LEVEL_CONFIG[level];
    const levelInstruction = `Target Level: JLPT ${level}. Use vocabulary and grammar suitable for ${level}.`;

    let prompt = "";
    // 分流处理 Prompt
    if (settings.selectedModel === 'gemini') {
        prompt = AIService.GEMINI_COURSE_PROMPT
          .replace('[TOPIC]', topic)
          .replace('[LEVEL_INSTRUCTION]', levelInstruction)
          .replace(/\[VOCAB_COUNT\]/g, config.vocab.toString())
          .replace(/\[GRAMMAR_COUNT\]/g, config.grammar.toString())
          .replace(/\[DIALOGUE_COUNT\]/g, config.dialogue.toString())
          .replace(/\[ESSAY_COUNT\]/g, config.essay.toString());
    } else {
        prompt = AIService.COURSE_PROMPT
          .replace('[LEVEL_INSTRUCTION]', levelInstruction)
          .replace(/\[VOCAB_COUNT\]/g, config.vocab.toString())
          .replace(/\[GRAMMAR_COUNT\]/g, config.grammar.toString())
          .replace(/\[DIALOGUE_COUNT\]/g, config.dialogue.toString())
          .replace(/\[ESSAY_COUNT\]/g, config.essay.toString())
          + `\nTopic: ${topic}`;
    }

    const json = settings.selectedModel === 'gemini' ? await AIService.callGemini(prompt, settings) : await AIService.callOpenAI(prompt, settings);
    const course = { ...json, id: crypto.randomUUID(), createdAt: Date.now(), level };
    return AIService.normalizeCourse(course);
  }

  static async generateDictionary(query: string, settings: AppSettings): Promise<VocabItem> {
    const prompt = AIService.DICT_PROMPT + `\nWORD: ${query}`;
    const raw = settings.selectedModel === 'gemini' ? await AIService.callGemini(prompt, settings) : await AIService.callOpenAI(prompt, settings);

    if (typeof raw.word === 'string') {
      raw.word = [{ text: raw.word }];
    }
    if (raw.example && typeof raw.example.text === 'string') {
      raw.example.text = [{ text: raw.example.text }];
    }
    return AIService.normalizeVocabItem(raw);
  }

  static async identifyImage(base64: string, settings: AppSettings): Promise<VocabItem> {
    const raw = settings.selectedModel === 'gemini' ? await AIService.callGemini(AIService.VISION_PROMPT, settings, base64) : await AIService.callOpenAI(AIService.VISION_PROMPT, settings, base64);
    if (typeof raw.word === 'string') raw.word = [{ text: raw.word }];
    if (raw.example && typeof raw.example.text === 'string') raw.example.text = [{ text: raw.example.text }];
    return AIService.normalizeVocabItem(raw);
  }
}

// ==========================================
// 4. UI 组件
// ==========================================

const FuriganaText: React.FC<{ segments: FuriganaSegment[]; className?: string }> = ({ segments, className = "" }) => {
  if (!segments) return null;
  const safeSegments = Array.isArray(segments) ? segments : [];
  return (
    <span className={`inline-flex flex-wrap items-baseline gap-x-0.5 leading-loose ${className}`}>
      {safeSegments.map((seg, idx) => (
        <React.Fragment key={idx}>
          {seg.furigana ? (
            <ruby className="group cursor-default font-normal">
              {seg.text}
              <rt className="text-[0.6em] text-gray-500 font-normal select-none group-hover:text-indigo-600 transition-colors">
                {seg.furigana}
              </rt>
            </ruby>
          ) : (
            <span>{seg.text}</span>
          )}
        </React.Fragment>
      ))}
    </span>
  );
};

// --- PlayButton (Updated to use TTSService) ---
const PlayButton: React.FC<{ text: string | FuriganaSegment[]; size?: 'sm' | 'md' | 'lg' }> = ({ text, size = 'md' }) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const settings = useContext(SettingsContext); // Access global settings

  const getTextString = () => {
    if (typeof text === 'string') return text;
    if (Array.isArray(text)) return text.map(s => s.furigana || s.text).join('');
    return "";
  };

  const handlePlay = (e: React.MouseEvent) => {
    e.stopPropagation();
    const str = getTextString();
    if (!str) return;

    setIsPlaying(true);
    TTSService.play(str, settings, () => setIsPlaying(false));
  };

  const sizeClasses = { sm: "w-6 h-6", md: "w-8 h-8", lg: "w-12 h-12" };
  const iconSizes = { sm: 12, md: 16, lg: 24 };
  return (
    <button onClick={handlePlay} className={`${sizeClasses[size]} rounded-full flex items-center justify-center bg-indigo-50 text-indigo-600 hover:bg-indigo-100 ${isPlaying ? 'animate-pulse ring-2 ring-indigo-300' : ''}`}>
      <Volume2 size={iconSizes[size]} />
    </button>
  );
};

const EssayPlayer: React.FC<{ segments: TextItem[] }> = ({ segments }) => {
  const [status, setStatus] = useState<'idle' | 'playing'>('idle');
  const settings = useContext(SettingsContext);
  const fullText = useMemo(() => segments.map(s => s.text.map(t => t.furigana || t.text).join('')).join('。'), [segments]);

  const togglePlay = () => {
    if (status === 'playing') {
      TTSService.stop();
      setStatus('idle');
    } else {
      setStatus('playing');
      TTSService.play(fullText, settings, () => setStatus('idle'));
    }
  };

  return (
    <button onClick={togglePlay} className="flex items-center gap-2 bg-indigo-100 text-indigo-700 px-4 py-2 rounded-full font-bold hover:bg-indigo-200 transition-colors">
      {status === 'playing' ? <Pause size={16} /> : <Play size={16} />}
      {status === 'playing' ? '停止' : '全文朗读'}
    </button>
  );
};

// --- Auth Modal ---
const AuthModal: React.FC<{ isOpen: boolean; onClose: () => void }> = ({ isOpen, onClose }) => {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleAuth = async () => {
    if (!auth) { setError("Firebase 未配置"); return; }
    setLoading(true); setError("");
    try {
      if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
        await signInWithCustomToken(auth, __initial_auth_token);
      } else {
        if (isLogin) await signInWithEmailAndPassword(auth, email, password);
        else await createUserWithEmailAndPassword(auth, email, password);
      }
      onClose();
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-in fade-in">
      <div className="bg-white w-full max-w-sm rounded-3xl p-8 shadow-2xl relative">
        <button onClick={onClose} className="absolute top-4 right-4 text-gray-400 hover:text-gray-600"><X size={20} /></button>
        <h2 className="text-2xl font-bold text-gray-900 mb-2">{isLogin ? "欢迎回来" : "创建账号"}</h2>
        <div className="space-y-4">
          <input type="email" placeholder="邮箱" value={email} onChange={e => setEmail(e.target.value)} className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:border-indigo-500 outline-none" />
          <input type="password" placeholder="密码" value={password} onChange={e => setPassword(e.target.value)} className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:border-indigo-500 outline-none" />
          {error && <div className="text-red-500 text-xs">{error}</div>}
          <button onClick={handleAuth} disabled={loading} className="w-full bg-gray-900 text-white py-3 rounded-xl font-bold hover:bg-gray-800 flex justify-center">
            {loading ? <RefreshCw className="animate-spin" /> : (isLogin ? "登录" : "注册")}
          </button>
          <div className="text-center text-sm text-gray-500 cursor-pointer hover:text-indigo-600" onClick={() => setIsLogin(!isLogin)}>{isLogin ? "没有账号? 去注册" : "已有账号? 去登录"}</div>
        </div>
      </div>
    </div>
  );
};

// ==========================================
// 5. 主视图组件
// ==========================================

const FoundationView: React.FC = () => {
  const [kanaType, setKanaType] = useState<'hiragana' | 'katakana'>('hiragana');
  const [selectedKana, setSelectedKana] = useState<KanaDetail | null>(null);
  const [contextTab, setContextTab] = useState<'lifestyle' | 'business'>('lifestyle');
  const kanaList = useMemo(() => getKanaList(kanaType), [kanaType]);

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex justify-between items-end">
        <div><h2 className="text-3xl font-bold text-gray-900">日语基础</h2><p className="text-gray-500">掌握日语核心的 46 个清音</p></div>
        <div className="flex bg-gray-200 p-1 rounded-lg">
          <button onClick={() => setKanaType('hiragana')} className={`px-3 py-1 text-sm font-bold rounded-md ${kanaType === 'hiragana' ? 'bg-white shadow-sm' : 'text-gray-500'}`}>平假名</button>
          <button onClick={() => setKanaType('katakana')} className={`px-3 py-1 text-sm font-bold rounded-md ${kanaType === 'katakana' ? 'bg-white shadow-sm' : 'text-gray-500'}`}>片假名</button>
        </div>
      </div>
      <div className="grid grid-cols-5 md:grid-cols-8 gap-2">
        {kanaList.map((k, i) => (
          <button key={i} disabled={!k.char} onClick={() => k.char && setSelectedKana(k)} className={`aspect-square bg-white rounded-xl border border-gray-100 shadow-sm flex flex-col items-center justify-center hover:text-indigo-600 hover:shadow-md transition-all group ${!k.char ? 'opacity-0' : ''}`}>
            <span className="text-xl font-bold text-gray-800 group-hover:text-indigo-600">{k.char}</span>
            <span className="text-[10px] text-gray-400 uppercase">{k.romaji}</span>
          </button>
        ))}
      </div>
      {selectedKana && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4 animate-in fade-in">
          <div className="bg-white w-full max-w-2xl rounded-3xl overflow-hidden shadow-2xl relative animate-in zoom-in-95">
            <div className="bg-gray-50 px-6 py-4 flex justify-between items-center border-b border-gray-100">
              <h3 className="font-bold text-gray-500">假名详情</h3>
              <button onClick={() => setSelectedKana(null)} className="p-1 hover:bg-gray-200 rounded-full"><X size={20} /></button>
            </div>
            <div className="p-8 flex flex-col md:flex-row gap-8">
              <div className="flex flex-col items-center shrink-0 w-full md:w-40">
                <div className="w-32 h-32 bg-indigo-600 text-white rounded-3xl flex items-center justify-center text-7xl font-bold shadow-lg shadow-indigo-200 mb-4">{selectedKana.char}</div>
                <PlayButton text={selectedKana.char} size="lg" />
                <div className="mt-4 text-center"><span className="text-xs font-bold text-gray-400 uppercase">记忆法</span><p className="text-sm text-gray-600 mt-1">{selectedKana.mnemonic}</p></div>
              </div>
              <div className="flex-1 space-y-4">
                <div className="flex bg-gray-100 p-1 rounded-xl">
                  <button onClick={() => setContextTab('lifestyle')} className={`flex-1 py-2 rounded-lg text-sm font-bold flex items-center justify-center gap-2 ${contextTab === 'lifestyle' ? 'bg-white shadow-sm text-indigo-600' : 'text-gray-500'}`}><Coffee size={16} /> 生活场景</button>
                  <button onClick={() => setContextTab('business')} className={`flex-1 py-2 rounded-lg text-sm font-bold flex items-center justify-center gap-2 ${contextTab === 'business' ? 'bg-white shadow-sm text-blue-700' : 'text-gray-500'}`}><Briefcase size={16} /> 商务场景</button>
                </div>
                <div className="bg-white border border-gray-100 rounded-2xl p-6 shadow-sm">
                  <div className="mb-6"><div className="text-xs text-gray-400 font-bold uppercase mb-1">单词</div><div className="flex justify-between items-center"><div><div className="text-2xl font-bold text-gray-900"><FuriganaText segments={selectedKana.examples[contextTab].word} /></div><div className="text-sm text-gray-500">{selectedKana.examples[contextTab].meaning}</div></div><PlayButton text={selectedKana.examples[contextTab].word} size="md" /></div></div>
                  <div className="pt-4 border-t border-gray-100"><div className="text-xs text-gray-400 font-bold uppercase mb-2">例句</div><div className="flex gap-3 items-start"><PlayButton text={selectedKana.examples[contextTab].sentence} size="sm" /><div><FuriganaText segments={selectedKana.examples[contextTab].sentence} className="text-base text-gray-800 font-medium" /><div className="text-xs text-gray-400 mt-1">{selectedKana.examples[contextTab].translation}</div></div></div></div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const CourseGeneratorView: React.FC<any> = ({ settings, user, topic, setTopic, loading, setLoading, errorMsg, setErrorMsg, course, setCourse }) => {
  const [level, setLevel] = useState<JLPTLevel>('N5');
  const [selectedVocab, setSelectedVocab] = useState<VocabItem | null>(null);
  const [isSaved, setIsSaved] = useState(false);

  const handleGenerate = async () => {
    if (!topic) return;
    setLoading(true); setCourse(null); setErrorMsg("");
    try {
      const data = await AIService.generateCourse(topic, level, settings);
      setCourse(data); setIsSaved(false);
    } catch (e: any) { setErrorMsg(e.message || "未知错误"); }
    finally { setLoading(false); }
  };

  const handleSave = async () => {
    if (course) { await DBAdapter.archiveCourse(user, course); setIsSaved(true); }
  };

  return (
    <div className="space-y-8 pb-20 animate-in fade-in duration-500">
      <div className="text-center space-y-6 pt-10">
        <h2 className="text-3xl font-bold text-gray-900">今天想学什么？</h2>
        <div className="flex flex-col gap-4 max-w-xl mx-auto">
          <div className="flex items-center gap-2 bg-white p-2 rounded-2xl shadow-sm border border-gray-200">
            <input value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="例如: 居酒屋点餐, 商务邮件回复..." className="flex-1 px-4 py-2 bg-transparent outline-none text-lg" onKeyDown={(e) => e.key === 'Enter' && handleGenerate()} />
            <button onClick={handleGenerate} disabled={loading} className="bg-gray-900 text-white px-6 py-3 rounded-xl font-bold flex items-center gap-2 hover:bg-gray-800 disabled:opacity-50 transition-all">{loading ? <RefreshCw className="animate-spin" /> : <Brain size={20} />} 生成课程</button>
          </div>
          <div className="flex justify-center gap-2">
            {(['N5', 'N4', 'N3', 'N2', 'N1'] as JLPTLevel[]).map((lvl) => (
              <button key={lvl} onClick={() => setLevel(lvl)} className={`px-4 py-1.5 rounded-full text-sm font-bold transition-all ${level === lvl ? 'bg-indigo-600 text-white shadow-md' : 'bg-white text-gray-400 hover:bg-gray-50'}`}>{lvl}</button>
            ))}
          </div>
        </div>
        <div className="flex justify-center gap-2 text-xs text-gray-400"><span>模型: {settings.selectedModel === 'gemini' ? '⚡ Gemini 3 Flash' : '🧠 gpt-5.2'}</span></div>
        {errorMsg && <div className="text-red-600 text-sm bg-red-50 p-2 rounded">{errorMsg}</div>}
      </div>

      {course && (
        <div className="space-y-12 animate-in slide-in-from-bottom-8 duration-700">
          <div className="text-center border-b border-gray-200 pb-6"><span className="text-xs font-bold text-indigo-600 tracking-widest uppercase">AI 课程 ({level})</span><div className="text-4xl font-bold text-gray-900 mt-2 mb-2 flex justify-center gap-3"><FuriganaText segments={course.title} /><PlayButton text={course.title} size="lg" /></div><p className="text-gray-500">{course.topic}</p></div>
          <section>
            <h3 className="text-xl font-bold text-gray-800 mb-6 flex items-center gap-2"><div className="w-1 h-6 bg-indigo-500 rounded-full" /> 核心词汇</h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {course.vocabulary.map((vocab: any, i: number) => (
                <button key={i} onClick={() => setSelectedVocab(vocab)} className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm hover:shadow-md hover:border-indigo-200 transition-all text-left group">
                  <div className="text-lg font-bold text-gray-800 mb-1 group-hover:text-indigo-600"><FuriganaText segments={vocab.word} /></div>
                  <div className="text-xs text-gray-400 truncate">{vocab.meaning}</div>
                </button>
              ))}
            </div>
          </section>
          
          <section>
            <h3 className="text-xl font-bold text-gray-800 mb-6 flex items-center gap-2"><div className="w-1 h-6 bg-pink-500 rounded-full"/> 关键语法</h3>
            <div className="space-y-4">
              {course.grammar.map((g: any, i: number) => (
                <div key={i} className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm">
                  <div className="font-bold text-lg text-indigo-600 mb-2">{g.point}</div><p className="text-sm text-gray-600 mb-4">{g.explanation}</p>
                  <div className="bg-gray-50 p-3 rounded-xl flex gap-3 items-start"><PlayButton text={g.example.text} size="sm"/><div><FuriganaText segments={g.example.text} className="text-gray-800 font-medium"/><div className="text-xs text-gray-400 mt-1">{g.example.translation}</div></div></div>
                </div>
              ))}
            </div>
          </section>

          <section>
            <h3 className="text-xl font-bold text-gray-800 mb-6 flex items-center gap-2"><div className="w-1 h-6 bg-emerald-500 rounded-full" /> 对话与短文</h3>
            <div className="grid md:grid-cols-2 gap-6">
              <div className="bg-white p-6 rounded-3xl border border-gray-100 shadow-sm space-y-4">
                <h4 className="font-bold text-gray-400 text-xs uppercase mb-4">场景对话</h4>
                {course.texts.dialogue.map((line: any, i: number) => (
                  <div key={i} className="flex gap-3">
                    <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center text-xs font-bold text-gray-500 shrink-0">{line.role}</div>
                    <div><div className="flex items-center gap-2"><PlayButton text={line.text} size="sm" /><FuriganaText segments={line.text} className="text-lg font-medium" /></div><p className="text-sm text-gray-400 pl-8">{line.translation}</p></div>
                  </div>
                ))}
              </div>
              <div className="bg-white p-6 rounded-3xl border border-gray-100 shadow-sm">
                <div className="flex justify-between items-center mb-4"><h4 className="font-bold text-gray-400 text-xs uppercase">{course.texts.essay.title}</h4><EssayPlayer segments={course.texts.essay.content} /></div>
                <div className="space-y-6">
                  {course.texts.essay.content.map((sent: any, i: number) => (
                    <div key={i} className="group cursor-pointer hover:bg-gray-50 rounded-lg p-2 -mx-2 transition-colors">
                      <div className="flex gap-3 items-start"><PlayButton text={sent.text} size="sm" /><div><FuriganaText segments={sent.text} className="text-lg text-gray-800 leading-8" /><div className="text-sm text-gray-500 mt-1 border-t border-gray-100 pt-1">{sent.translation}</div></div></div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </section>
          <div className="flex justify-center pb-10"><button onClick={handleSave} disabled={isSaved} className={`px-8 py-4 rounded-full font-bold flex items-center gap-2 transition-all shadow-lg ${isSaved ? 'bg-green-100 text-green-700' : 'bg-gray-900 text-white hover:scale-105'}`}>{isSaved ? <CheckCircle size={20} /> : <Save size={20} />} {isSaved ? '已归档' : '完成并归档'}</button></div>
        </div>
      )}
      {selectedVocab && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4 animate-in fade-in">
          <div className="bg-white w-full max-w-lg rounded-3xl p-8 shadow-2xl relative animate-in zoom-in-95 duration-200">
            <button onClick={() => setSelectedVocab(null)} className="absolute top-4 right-4 p-2 bg-gray-100 rounded-full hover:bg-gray-200"><X size={20} /></button>
            <div className="flex flex-col items-center text-center space-y-4">
              <div className="text-xs font-bold bg-indigo-50 text-indigo-600 px-3 py-1 rounded-full uppercase tracking-wider">{selectedVocab.grammar_tag}</div>
              <div className="text-5xl font-bold text-gray-900 mb-2"><FuriganaText segments={selectedVocab.word} /></div>
              <PlayButton text={selectedVocab.word} size="lg" />
              <p className="text-xl text-gray-600 font-medium">{selectedVocab.meaning}</p>
              <div className="w-full bg-gray-50 rounded-2xl p-6 mt-6 text-left">
                <div className="text-xs text-gray-400 font-bold uppercase mb-3">例句</div>
                <div className="flex gap-3 items-start mb-2"><PlayButton text={selectedVocab.example.text} size="sm" /><FuriganaText segments={selectedVocab.example.text} className="text-lg font-medium text-gray-800" /></div>
                <p className="text-sm text-gray-500 pl-9">{selectedVocab.example.translation}</p>
                {selectedVocab.example.grammar_point && <div className="mt-4 pt-3 border-t border-gray-200/50"><div className="flex gap-2 items-center mb-1"><Brain size={14} className="text-pink-500"/><span className="text-xs font-bold text-gray-400 uppercase">语法深度解析</span></div><p className="text-sm text-gray-700 leading-relaxed pl-6">{selectedVocab.example.grammar_point}</p></div>}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const ReviewCenterView: React.FC<{ user: FirebaseUser | null }> = ({ user }) => {
  const [queue, setQueue] = useState<SRSItem[]>([]);
  const [currentItem, setCurrentItem] = useState<SRSItem | null>(null);
  const [isFlipped, setIsFlipped] = useState(false);
  const [stats, setStats] = useState({ total: 0, pending: 0 });

  useEffect(() => {
    if (user && db) {
      DBAdapter.getReviewQueue(user).then(items => { setQueue(items); setStats({ total: items.length, pending: items.length }); });
    } else {
      DBAdapter.getReviewQueue(null).then(items => { setQueue(items); setStats({ total: items.length, pending: items.length }); });
    }
  }, [user]);

  const handleGrade = async (grade: 'hard' | 'good' | 'easy') => {
    if (!currentItem) return;
    await DBAdapter.updateSRS(user, currentItem, grade);
    const next = queue.slice(1);
    setQueue(next); setCurrentItem(next[0] || null); setIsFlipped(false);
  };

  if (!currentItem && queue.length > 0) return <div className="text-center py-20"><h2 className="text-2xl font-bold mb-4">今日待复习: {queue.length} 个</h2><button onClick={() => setCurrentItem(queue[0])} className="bg-black text-white px-8 py-3 rounded-full font-bold">开始</button></div>;

  if (currentItem) {
    const vocab = currentItem.content as VocabItem;
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] max-w-xl mx-auto space-y-8 animate-in fade-in">
        <div className="w-full flex justify-between items-center px-4"><span className="text-sm font-bold text-gray-400">剩余: {queue.length}</span><button onClick={() => setCurrentItem(null)} className="text-gray-400 hover:text-gray-900">退出</button></div>
        <div onClick={() => setIsFlipped(!isFlipped)} className="w-full aspect-[4/3] bg-white rounded-3xl shadow-xl border border-gray-100 flex flex-col items-center justify-center cursor-pointer hover:shadow-2xl transition-all relative overflow-hidden group">
          <div className="text-xs font-bold text-gray-300 absolute top-6 uppercase tracking-widest">{isFlipped ? '答案' : '问题'}</div>
          {!isFlipped && <div className="text-5xl font-bold text-gray-900">{vocab.word.map(s => s.text).join('')}</div>}
          {isFlipped && (
            <div className="text-center space-y-4 animate-in fade-in slide-in-from-bottom-2">
              <div className="text-4xl font-bold text-gray-900 mb-2"><FuriganaText segments={vocab.word} /></div>
              <div className="text-xl text-indigo-600 font-medium">{vocab.meaning}</div>
              <div className="text-sm text-gray-400 max-w-xs mx-auto">{vocab.example.translation}</div>
              <div className="flex justify-center pt-2"><PlayButton text={vocab.word} size="lg" /></div>
            </div>
          )}
          <div className="absolute bottom-4 text-xs text-gray-300 opacity-0 group-hover:opacity-100 transition-opacity">点击翻转</div>
        </div>
        {isFlipped && (
          <div className="grid grid-cols-3 gap-4 w-full">
            <button onClick={() => handleGrade('hard')} className="p-4 rounded-2xl bg-red-50 text-red-600 font-bold hover:bg-red-100 transition-colors">忘记</button>
            <button onClick={() => handleGrade('good')} className="p-4 rounded-2xl bg-yellow-50 text-yellow-600 font-bold hover:bg-yellow-100 transition-colors">模糊</button>
            <button onClick={() => handleGrade('easy')} className="p-4 rounded-2xl bg-green-50 text-green-600 font-bold hover:bg-green-100 transition-colors">掌握</button>
          </div>
        )}
      </div>
    );
  }
  return <div className="text-center py-20 space-y-6 animate-in fade-in"><div className="w-24 h-24 bg-indigo-100 text-indigo-600 rounded-full mx-auto flex items-center justify-center mb-6"><Clock size={48} /></div><h2 className="text-3xl font-bold text-gray-900">复习中心</h2><p className="text-gray-500 max-w-md mx-auto">智能 SRS 记忆算法帮助你巩固每一个知识点。</p><div className="py-8"><div className="text-6xl font-black text-gray-900 mb-2">{stats.pending}</div><div className="text-sm font-bold text-gray-400 uppercase tracking-widest">今日任务</div></div><button onClick={() => queue.length > 0 && setCurrentItem(queue[0])} disabled={queue.length === 0} className="bg-gray-900 text-white px-10 py-4 rounded-full font-bold text-lg hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-xl shadow-gray-200">开始复习</button></div>;
};

const DictionaryView: React.FC<{ settings: AppSettings }> = ({ settings }) => {
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<VocabItem | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleSearch = async () => {
    if (!query) return;
    setLoading(true); setResult(null); setError("");
    try { const res = await AIService.generateDictionary(query, settings); setResult(res); } catch (e: any) { setError("查询失败，请检查网络或 Key"); } finally { setLoading(false); }
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onloadend = async () => {
      const base64String = (reader.result as string).replace('data:', '').replace(/^.+,/, '');
      setLoading(true); setError(""); setResult(null);
      try { const res = await AIService.identifyImage(base64String, settings); setResult(res); } catch (err: any) { setError("图片识别失败: " + err.message); } finally { setLoading(false); }
    };
    reader.readAsDataURL(file);
  };

  return (
    <div className="max-w-2xl mx-auto pt-10 space-y-8 animate-in fade-in">
      <div className="text-center space-y-4">
        <h2 className="text-2xl font-bold text-gray-900">AI 多模态词典</h2>
        <div className="flex gap-2 bg-white p-2 rounded-2xl shadow-sm border border-gray-200">
          <input className="flex-1 px-4 outline-none" placeholder="输入单词..." value={query} onChange={e => setQuery(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleSearch()} />
          <input type="file" ref={fileInputRef} className="hidden" accept="image/*" onChange={handleImageUpload} />
          <button onClick={() => fileInputRef.current?.click()} className="bg-gray-100 p-3 rounded-xl hover:bg-gray-200 text-gray-500"><Camera size={20} /></button>
          <button onClick={handleSearch} className="bg-indigo-600 text-white p-3 rounded-xl hover:bg-indigo-700">{loading ? <RefreshCw className="animate-spin" size={20} /> : <Search size={20} />}</button>
        </div>
        {error && <div className="text-red-500 text-sm">{error}</div>}
      </div>
      {result && (
        <div className="bg-white p-8 rounded-3xl shadow-xl border border-gray-100 space-y-6 animate-in slide-in-from-bottom-4">
          <div className="flex justify-between items-start">
            <div><div className="text-xs font-bold text-indigo-500 uppercase mb-1">{result.grammar_tag}</div><div className="text-4xl font-bold text-gray-900"><FuriganaText segments={result.word} /></div><div className="text-xl text-gray-500 mt-1">{result.meaning}</div></div>
            <PlayButton text={result.word} size="lg" />
          </div>
          <div className="bg-gray-50 p-6 rounded-2xl">
            <div className="flex gap-3 items-start"><PlayButton text={result.example.text} size="sm" /><div><FuriganaText segments={result.example.text} className="text-lg text-gray-800" /><div className="text-gray-500 mt-1">{result.example.translation}</div></div></div>
            {result.example.grammar_point && <div className="mt-3 pt-3 border-t border-gray-200 text-sm text-gray-600"><span className="font-bold text-gray-400 uppercase text-xs">语法分析:</span> {result.example.grammar_point}</div>}
          </div>
        </div>
      )}
    </div>
  );
};

const SettingsModal: React.FC<{ isOpen: boolean; onClose: () => void; onSave: (s: AppSettings) => void }> = ({ isOpen, onClose, onSave }) => {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  
  // Load settings when modal opens
  useEffect(() => {
    setSettings(LocalStorageManager.getSettings());
  }, [isOpen]);

  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm p-4 animate-in fade-in">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center"><h3 className="font-bold text-lg text-gray-800 flex items-center gap-2"><Settings size={20} /> 系统设置</h3><button onClick={onClose}><X size={20} className="text-gray-400" /></button></div>
        <div className="p-6 space-y-6 h-[60vh] overflow-y-auto">
          <div><label className="block text-xs font-bold text-gray-400 uppercase mb-1">用户名</label><input value={settings.userName} onChange={e => setSettings({ ...settings, userName: e.target.value })} className="w-full px-3 py-2 border rounded-lg" /></div>
          
          <div>
            <label className="block text-xs font-bold text-gray-400 uppercase mb-2">文本生成模型 (AI Tutor)</label>
            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => setSettings({ ...settings, selectedModel: 'gemini' })} className={`p-2 border rounded-lg text-sm font-bold ${settings.selectedModel === 'gemini' ? 'bg-indigo-50 border-indigo-500 text-indigo-700' : 'text-gray-500'}`}>⚡ Gemini 3 Flash</button>
              <button onClick={() => setSettings({ ...settings, selectedModel: 'openai' })} className={`p-2 border rounded-lg text-sm font-bold ${settings.selectedModel === 'openai' ? 'bg-green-50 border-green-500 text-green-700' : 'text-gray-500'}`}>🧠 gpt-5.2/button>
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-gray-400 uppercase mb-2">语音引擎 (TTS Provider)</label>
            <div className="space-y-2">
              <button onClick={() => setSettings({ ...settings, ttsProvider: 'browser' })} className={`w-full p-3 border rounded-xl text-left flex items-center justify-between ${settings.ttsProvider === 'browser' ? 'bg-gray-100 border-gray-400' : ''}`}>
                <span className="font-bold text-sm">浏览器默认 (免费)</span>
                {settings.ttsProvider === 'browser' && <CheckCircle size={16} className="text-gray-900"/>}
              </button>
              <button onClick={() => setSettings({ ...settings, ttsProvider: 'google_cloud' })} className={`w-full p-3 border rounded-xl text-left flex items-center justify-between ${settings.ttsProvider === 'google_cloud' ? 'bg-blue-50 border-blue-500 text-blue-700' : ''}`}>
                <div><div className="font-bold text-sm">Google Cloud TTS</div><div className="text-xs opacity-70">Neural2 (自然音质)</div></div>
                {settings.ttsProvider === 'google_cloud' && <CheckCircle size={16}/>}
              </button>
              <button onClick={() => setSettings({ ...settings, ttsProvider: 'openai' })} className={`w-full p-3 border rounded-xl text-left flex items-center justify-between ${settings.ttsProvider === 'openai' ? 'bg-green-50 border-green-500 text-green-700' : ''}`}>
                <div><div className="font-bold text-sm">OpenAI TTS</div><div className="text-xs opacity-70">TTS-1 (拟人情感)</div></div>
                {settings.ttsProvider === 'openai' && <CheckCircle size={16}/>}
              </button>
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-gray-400 uppercase mb-1">API 密钥配置</label>
            <div className="space-y-3">
              <input type="password" placeholder="Gemini API Key" value={settings.geminiKey} onChange={e => setSettings({ ...settings, geminiKey: e.target.value })} className="w-full px-3 py-2 border rounded-lg text-sm" />
              <input type="password" placeholder="OpenAI API Key (通用)" value={settings.openaiKey} onChange={e => setSettings({ ...settings, openaiKey: e.target.value })} className="w-full px-3 py-2 border rounded-lg text-sm" />
              {settings.ttsProvider === 'google_cloud' && (
                <div className="animate-in slide-in-from-top-2 fade-in">
                  <input type="password" placeholder="Google Cloud TTS API Key" value={settings.googleTTSKey} onChange={e => setSettings({ ...settings, googleTTSKey: e.target.value })} className="w-full px-3 py-2 border border-blue-200 bg-blue-50 rounded-lg text-sm text-blue-800 placeholder-blue-300" />
                  <p className="text-[10px] text-blue-500 mt-1">需在 Google Cloud Console 启用 Text-to-Speech API</p>
                </div>
              )}
            </div>
          </div>
        </div>
        <div className="p-4 bg-gray-50 flex justify-end"><button onClick={() => { DBAdapter.saveSettings(auth?.currentUser, settings); onSave(settings); onClose(); }} className="bg-gray-900 text-white px-6 py-2 rounded-lg font-bold">保存</button></div>
      </div>
    </div>
  );
};

export default function NihongoFlowSaaS() {
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [currentView, setCurrentView] = useState<'foundation' | 'course' | 'dict' | 'review'>('course');
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [showAuth, setShowAuth] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  // Lifted Course State
  const [courseTopic, setCourseTopic] = useState("");
  const [courseLoading, setCourseLoading] = useState(false);
  const [courseError, setCourseError] = useState("");
  const [generatedCourse, setGeneratedCourse] = useState<CourseData | null>(null);

  useEffect(() => {
    const initAuth = async () => {
      if (!auth) return;
      try {
        if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
           await signInWithCustomToken(auth, __initial_auth_token);
        } else {
           // await signInAnonymously(auth); 
        }
      } catch (error) { console.warn("Auth warning", error); }
    };
    initAuth();
  }, []);

  useEffect(() => {
    if (auth) {
      return onAuthStateChanged(auth, async (u) => {
        setUser(u);
        const syncedSettings = await DBAdapter.loadSettings(u);
        setSettings(syncedSettings);
      });
    } else {
      setSettings(LocalStorageManager.getSettings());
    }
  }, []);

  return (
    <SettingsContext.Provider value={settings}>
      <div className="min-h-screen bg-[#F5F5F7] text-gray-800 font-sans">
        <header className="sticky top-0 bg-white/80 backdrop-blur-md border-b z-50 h-16 px-4 flex items-center justify-between">
          <div className="flex items-center gap-2 font-bold text-lg"><div className="bg-black text-white p-1 rounded">JP</div> Nihongo Flow Pro</div>
          <div className="flex items-center gap-4">
            {user ? (
              <div className="flex items-center gap-2 text-sm"><span className="text-green-600 flex items-center gap-1"><Cloud size={14} /> Synced</span><span className="font-bold">{user.email?.split('@')[0]}</span><button onClick={() => signOut(auth)} className="text-gray-400 hover:text-red-500"><LogOut size={16} /></button></div>
            ) : (
              <button onClick={() => setShowAuth(true)} className="flex items-center gap-2 text-sm font-bold bg-gray-100 px-3 py-1.5 rounded-full hover:bg-gray-200"><User size={16} /> 登录 / 注册</button>
            )}
            <button onClick={() => setShowSettings(true)} className="p-2 bg-gray-100 rounded-full hover:bg-gray-200"><Settings size={18} /></button>
          </div>
        </header>

        <main className="pt-8 px-4 max-w-4xl mx-auto pb-24">
          {currentView === 'foundation' && <FoundationView />}
          {currentView === 'course' && (
            <CourseGeneratorView settings={settings} user={user} topic={courseTopic} setTopic={setCourseTopic} loading={courseLoading} setLoading={setCourseLoading} errorMsg={courseError} setErrorMsg={setCourseError} course={generatedCourse} setCourse={setGeneratedCourse} />
          )}
          {currentView === 'review' && <ReviewCenterView user={user} />}
          {currentView === 'dict' && <DictionaryView settings={settings} />}
        </main>

        <nav className="fixed bottom-0 w-full bg-white border-t flex justify-around p-2 pb-safe z-40">
          {[{ id: 'foundation', icon: Book, label: '五十音' }, { id: 'course', icon: GraduationCap, label: '课程' }, { id: 'review', icon: Brain, label: '复习' }, { id: 'dict', icon: Search, label: '词典' }].map(item => (
            <button key={item.id} onClick={() => setCurrentView(item.id as any)} className={`flex flex-col items-center p-2 rounded-xl transition-all ${currentView === item.id ? 'text-indigo-600 scale-110' : 'text-gray-400'}`}>
              <item.icon size={24} strokeWidth={currentView === item.id ? 2.5 : 2} />
              <span className="text-[10px] font-bold mt-1">{item.label}</span>
            </button>
          ))}
        </nav>

        <AuthModal isOpen={showAuth} onClose={() => setShowAuth(false)} />
        <SettingsModal isOpen={showSettings} onClose={() => setShowSettings(false)} onSave={setSettings} />

        {!auth && <div className="fixed bottom-24 left-4 right-4 bg-amber-50 border border-amber-200 p-4 rounded-xl text-sm text-amber-800 flex gap-3 shadow-lg z-50"><AlertTriangle className="shrink-0" /><div><strong>Firebase 未配置</strong><p>请在代码顶部的 <code>firebaseConfig</code> 中填入你的配置以启用云端同步。</p></div></div>}
        <style>{`ruby { ruby-position: over; } rt { font-feature-settings: "ruby" 1; }`}</style>
      </div>
    </SettingsContext.Provider>
  );
}
