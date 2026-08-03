// ===== 地区音乐歌单 =====
export const REGION_PLAYLISTS = {
  '关都': [
    'kanto/kanto1.mp3',
    'kanto/kanto2.mp3',
    'kanto/kanto3.mp3',
    'kanto/kanto4.mp3',
  ],
  '城都': [
    'johto/johto1.mp3',
    'johto/johto2.mp3',
    'johto/johto3.mp3',
    'johto/johto4.mp3',
    'johto/johto5.mp3',
  ],
  '丰缘': [
    'hoenn/hoenn1.mp3',
    'hoenn/hoenn2.mp3',
    'hoenn/hoenn3.mp3',
    'hoenn/hoenn4.mp3',
    'hoenn/hoenn5.mp3',
  ],
  '神奥': [
    'sinnoh/sinnoh1.mp3',
    'sinnoh/sinnoh2.mp3',
    'sinnoh/sinnoh3.mp3',
    'sinnoh/sinnoh4.mp3',
    'sinnoh/sinnoh5.mp3',
    'sinnoh/sinnoh6.mp3',
  ],
  '合众': [
    'unova/unova1.mp3',
    'unova/unova2.mp3',
    'unova/unova3.mp3',
    'unova/unova4.mp3',
    'unova/unova5.mp3',
  ],
  '卡洛斯': [
    'kalos/kalos1.mp3',
    'kalos/kalos2.mp3',
    'kalos/kalos3.mp3',
    'kalos/kalos4.mp3',
  ],
  '阿罗拉': [
    'alola/alola1.mp3',
    'alola/alola2.mp3',
    'alola/alola3.mp3',
    'alola/alola4.mp3',
    'alola/alola5.mp3',
  ],
  '伽勒尔': [
    'galar/galar1.mp3',
    'galar/galar2.mp3',
    'galar/galar3.mp3',
    'galar/galar4.mp3',
  ],
  '帕底亚': [
    'paldea/paldea1.mp3',
    'paldea/paldea2.mp3',
    'paldea/paldea3.mp3',
    'paldea/paldea4.mp3',
    'paldea/paldea5.mp3',
  ],
};

// 事件音效
export const SFX = {
  battle: 'Battle.mp3',          // 进入战斗
  cycling: 'Cycling.mp3',        // 骑自行车
  victory: 'Victory.mp3',        // 抓捕成功
  congratulation: 'Congratulation.mp3', // 交换 / 孵蛋得到宝可梦
  obtained: 'Obtained.mp3',      // 混合器得到树果方块
};

// 开场曲：选完主角进入场景后直接播放（未白镇）
export const INTRO_TRACK = 'hoenn/hoenn1.mp3';

// ===== 响度补偿表 =====
export const TRACK_GAINS = {
  'kanto/kanto1.mp3': -5.00,
  'kanto/kanto2.mp3': -5.30,
  'kanto/kanto3.mp3': -3.00,
  'kanto/kanto4.mp3': -6.30,
  'johto/johto1.mp3': -3.90,
  'johto/johto2.mp3': -4.80,
  'johto/johto3.mp3': -6.40,
  'johto/johto4.mp3': -4.80,
  'johto/johto5.mp3': -7.40,
  'hoenn/hoenn1.mp3': 0,
  'hoenn/hoenn2.mp3': -1.00,
  'hoenn/hoenn3.mp3': 5.20,
  'hoenn/hoenn4.mp3': -1.30,
  'hoenn/hoenn5.mp3': -1.90,
  'sinnoh/sinnoh1.mp3': 0.80,
  'sinnoh/sinnoh2.mp3': -9.00,
  'sinnoh/sinnoh3.mp3': -3.50,
  'sinnoh/sinnoh4.mp3': -4.20,
  'sinnoh/sinnoh5.mp3': -2.40,
  'sinnoh/sinnoh6.mp3': -2.50,
  'unova/unova1.mp3': -4.80,
  'unova/unova2.mp3': -8.10,
  'unova/unova3.mp3': -6.30,
  'unova/unova4.mp3': -7.70,
  'unova/unova5.mp3': -8.70,
  'kalos/kalos1.mp3': -7.00,
  'kalos/kalos2.mp3': -7.30,
  'kalos/kalos3.mp3': -7.50,
  'kalos/kalos4.mp3': -3.80,
  'alola/alola1.mp3': -5.90,
  'alola/alola2.mp3': -0.10,
  'alola/alola3.mp3': -8.30,
  'alola/alola4.mp3': -6.70,
  'alola/alola5.mp3': -7.40,
  'galar/galar1.mp3': -5.90,
  'galar/galar2.mp3': -5.70,
  'galar/galar3.mp3': -4.50,
  'galar/galar4.mp3': -5.10,
  'paldea/paldea1.mp3': -6.60,
  'paldea/paldea2.mp3': -8.00,
  'paldea/paldea3.mp3': -3.60,
  'paldea/paldea4.mp3': -7.20,
  'paldea/paldea5.mp3': -7.70,
  'Battle.mp3': -3.50,
  'Cycling.mp3': -0.10,
  'Victory.mp3': -0.90,
  'Congratulation.mp3': 0.10,
  'Obtained.mp3': 1.00,
};
