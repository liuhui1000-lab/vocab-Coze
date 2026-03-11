// Utility functions for vocabulary app

// 获取当前学习日的基准时间（凌晨4点作为一天的分界）
// 如果当前时间 < 04:00，则算作"昨天"的学习日
export function getStudyDayDate(): Date {
  const now = new Date();
  if (now.getHours() < 4) {
    // 凌晨4点前，算作昨天
    now.setDate(now.getDate() - 1);
  }
  return now;
}

// 判断给定日期是否在当前学习日或之前（用于待复习判断）
// 基于凌晨4点分界：凌晨4点前算作"昨天"
export function isDueForReview(reviewDateStr: string): boolean {
  // 从 ISO 字符串中提取日期部分 (YYYY-MM-DD)
  const reviewDatePart = reviewDateStr.split('T')[0];
  
  // 获取当前学习日的日期字符串
  const studyDayString = getStudyDayString();
  
  // 比较日期字符串：如果复习日期 <= 当前学习日，则需要复习
  return reviewDatePart <= studyDayString;
}

// Format date to YYYY-MM-DD（本地时间，用于存储和比较）
export function formatDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// 获取格式化的学习日日期（用于统计表）
export function getStudyDayString(): string {
  return formatDate(getStudyDayDate());
}

// Calculate next review time based on SM-2 algorithm with分层机制
// 🟢 学霸词 (failureCount === 0): 正常SM-2，间隔 × 2.5
// 🔴 康复词 (failureCount > 0): 双重验证机制
//    - 答错后：interval = 1（明天复习）
//    - 从错题池答对（isFromErrorPool=true）：interval 锁定为 1（明天再考一次）
//    - 连续答对2次后：恢复正常乘法
// 
// 返回的 nextReview 是本地日期字符串 "YYYY-MM-DD"，与 isDueForReview 的比较逻辑一致
export function calculateNextReview(
  success: boolean,
  currentEf: number,
  currentInterval: number,
  isNewWord: boolean = false,
  failureCount: number = 0,
  isFromErrorPool: boolean = false
): { ef: number; interval: number; nextReview: string } {
  let ef = currentEf;
  let interval = currentInterval;
  
  // 🟢 学霸词：无案底，正常SM-2
  const isTopStudent = failureCount === 0;
  
  if (success) {
    if (isNewWord) {
      // 新词第一次答对：直接跳到 3天后（学霸快车道）
      interval = 3;
    } else if (isFromErrorPool && !isTopStudent) {
      // 🔴 康复词从错题池答对：interval 锁定为 1（明天再考一次！）
      // 系统潜台词："我不信你真记住了，明天再考你一次！"
      interval = 1;
    } else {
      // 正常复习词答对：间隔 × EF（2.5倍）
      interval = Math.ceil(interval * (ef / 10));
    }
    // 增加 EF（最高 2.5）
    ef = Math.min(25, ef + 1);
  } else {
    // 🔴 答错：EF 降低（最低 1.3），interval 强制为 1（明天重背）
    // 同时标记为有案底，进入康复词池
    ef = Math.max(13, ef - 2);
    interval = 1;  // 强制明天复习
  }
  
  // 使用学习日基准时间，计算下次复习日期
  const baseDate = getStudyDayDate();
  const nextReviewDate = new Date(baseDate);
  nextReviewDate.setDate(nextReviewDate.getDate() + interval);
  
  // 返回日期字符串 "YYYY-MM-DD"
  const nextReview = formatDate(nextReviewDate);
  
  console.log('[calculateNextReview]', {
    success,
    isNewWord,
    failureCount,
    isFromErrorPool,
    isTopStudent,
    calculatedInterval: interval,
    baseDate: formatDate(baseDate),
    nextReview
  });
  
  return { ef, interval, nextReview };
}

// Get words to review today (基于凌晨4点分界的自然天)
export function getWordsToReview(words: WordWithProgress[]): WordWithProgress[] {
  return words.filter(w => {
    if (!w.progress || w.progress.state === 'new') return false;
    if (!w.progress.next_review) return false;
    return isDueForReview(w.progress.next_review);
  });
}

// Get new words
export function getNewWords(words: WordWithProgress[], limit: number): WordWithProgress[] {
  return words
    .filter(w => !w.progress || w.progress.state === 'new')
    .slice(0, limit);
}

// Shuffle array
export function shuffleArray<T>(array: T[]): T[] {
  const result = [...array];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

// Play word pronunciation
export function playWord(word: string): void {
  if (typeof window === 'undefined') return;
  
  const url = `https://dict.youdao.com/dictvoice?audio=${encodeURIComponent(word)}&type=2&_t=${Date.now()}`;
  const audio = new Audio(url);
  audio.play().catch(() => {
    // Fallback to speech synthesis
    if ('speechSynthesis' in window) {
      const utterance = new SpeechSynthesisUtterance(word);
      utterance.lang = 'en-US';
      window.speechSynthesis.speak(utterance);
    }
  });
}

import type { WordWithProgress } from '@/lib/types';
