/* =========================================================
   大马吉通 (DaMaJitong MY) Supabase 核心接口 & 公共工具 api.js
   ========================================================= */
const DMJT_CONFIG = {
  SUPABASE_URL: 'https://uhgukdqggvyaepkvlugg.supabase.co',
  SUPABASE_ANON_KEY: 'sb_publishable_mJ6eEsaqtRcuikGbQiUEPQ_-tLIRrHU'
};

const dmjtSupabase = window.supabase.createClient(
  DMJT_CONFIG.SUPABASE_URL,
  DMJT_CONFIG.SUPABASE_ANON_KEY
);

// 马来西亚 13 州 + 3 联邦直辖区（含默认中心坐标，方便无精确地址时一键跳转站内地图导航）
const DMJT_REGIONS = [
  { value: '全马', group: 'all', zh: '全马地区', en: 'All Malaysia', ms: 'Seluruh Malaysia', lat: 3.1390, lng: 101.6869 },
  { value: '吉隆坡', group: 'ft', zh: '吉隆坡 (直辖区)', en: 'Kuala Lumpur (FT)', ms: 'WP Kuala Lumpur', lat: 3.1390, lng: 101.6869 },
  { value: '布城', group: 'ft', zh: '布城 (直辖区)', en: 'Putrajaya (FT)', ms: 'WP Putrajaya', lat: 2.9264, lng: 101.6964 },
  { value: '纳闽', group: 'ft', zh: '纳闽 (直辖区)', en: 'Labuan (FT)', ms: 'WP Labuan', lat: 5.2831, lng: 115.2308 },
  { value: '柔佛', group: 'west', zh: '柔佛 Johor', en: 'Johor', ms: 'Johor', lat: 1.4927, lng: 103.7414 },
  { value: '吉打', group: 'west', zh: '吉打 Kedah', en: 'Kedah', ms: 'Kedah', lat: 6.1184, lng: 100.3685 },
  { value: '吉兰丹', group: 'west', zh: '吉兰丹 Kelantan', en: 'Kelantan', ms: 'Kelantan', lat: 6.1254, lng: 102.2381 },
  { value: '马六甲', group: 'west', zh: '马六甲 Melaka', en: 'Melaka', ms: 'Melaka', lat: 2.1896, lng: 102.2501 },
  { value: '森美兰', group: 'west', zh: '森美兰 Negeri Sembilan', en: 'Negeri Sembilan', ms: 'Negeri Sembilan', lat: 2.7258, lng: 101.9424 },
  { value: '彭亨', group: 'west', zh: '彭亨 Pahang', en: 'Pahang', ms: 'Pahang', lat: 3.8126, lng: 103.3256 },
  { value: '槟城', group: 'west', zh: '槟城 Penang', en: 'Penang', ms: 'Pulau Pinang', lat: 5.4141, lng: 100.3288 },
  { value: '霹雳', group: 'west', zh: '霹雳 Perak', en: 'Perak', ms: 'Perak', lat: 4.5975, lng: 101.0901 },
  { value: '玻璃市', group: 'west', zh: '玻璃市 Perlis', en: 'Perlis', ms: 'Perlis', lat: 6.4449, lng: 100.2048 },
  { value: '雪兰莪', group: 'west', zh: '雪兰莪 Selangor', en: 'Selangor', ms: 'Selangor', lat: 3.0738, lng: 101.5183 },
  { value: '登嘉楼', group: 'west', zh: '登嘉楼 Terengganu', en: 'Terengganu', ms: 'Terengganu', lat: 5.3117, lng: 103.1324 },
  { value: '沙巴', group: 'east', zh: '沙巴 Sabah', en: 'Sabah', ms: 'Sabah', lat: 5.9804, lng: 116.0735 },
  { value: '砂拉越', group: 'east', zh: '砂拉越 Sarawak', en: 'Sarawak', ms: 'Sarawak', lat: 1.5533, lng: 110.3592 }
];

const DMJT_API = {
  getLang() {
    return localStorage.getItem('dama_lang') || 'zh';
  },
  setLang(lang) {
    localStorage.setItem('dama_lang', lang);
  },
  getRegionInfo(val) {
    if (val === '吉隆坡/雪兰莪') return DMJT_REGIONS.find(r => r.value === '吉隆坡');
    if (val === '新山') return DMJT_REGIONS.find(r => r.value === '柔佛');
    return DMJT_REGIONS.find(r => r.value === val) || DMJT_REGIONS[0];
  },
  getRegionLabel(val, lang) {
    const l = lang || this.getLang();
    if (val === '吉隆坡/雪兰莪') return l === 'zh' ? '吉隆坡 / 雪兰莪' : 'KL / Selangor';
    if (val === '新山') return l === 'zh' ? '新山 Johor' : 'Johor Bahru';
    const r = this.getRegionInfo(val);
    return r ? r[l] : val;
  },
  // 获取全部帖子（若后续开启审核列 status，可在此统一过滤）
  async getAllPosts() {
    const { data, error } = await dmjtSupabase
      .from('posts')
      .select('*')
      .order('is_pinned', { ascending: false })
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data || [];
  },
  // 根据 ID 获取单条帖子详情
  async getPostById(id) {
    const { data, error } = await dmjtSupabase
      .from('posts')
      .select('*')
      .eq('id', id)
      .single();
    if (error) throw error;
    return data;
  },
  // 获取同城/同类推荐帖子
  async getRelatedPosts(category, excludeId, limit = 4) {
    const { data, error } = await dmjtSupabase
      .from('posts')
      .select('*')
      .eq('category', category)
      .neq('id', excludeId)
      .order('is_pinned', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) return [];
    return data || [];
  },
  // 压缩并上传图片到 Supabase images 桶
  async uploadImage(file) {
    const blob = await new Promise((resolve) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = (e) => {
        const img = new Image();
        img.src = e.target.result;
        img.onload = () => {
          const canvas = document.createElement('canvas');
          let w = img.width, h = img.height;
          if (w > 1000) {
            h = Math.round((h * 1000) / w);
            w = 1000;
          }
          canvas.width = w;
          canvas.height = h;
          canvas.getContext('2d').drawImage(img, 0, 0, w, h);
          canvas.toBlob((b) => resolve(b), 'image/jpeg', 0.82);
        };
      };
    });
    const fileName = `${Date.now()}_${Math.random().toString(36).substring(2, 8)}.jpg`;
    const { error } = await dmjtSupabase.storage
      .from('images')
      .upload(fileName, blob, { contentType: 'image/jpeg' });
    if (error) throw error;
    const { data } = dmjtSupabase.storage.from('images').getPublicUrl(fileName);
    return data.publicUrl;
  },
  // 一键三语自动翻译
  async translateText(text, targetLang) {
    if (!text) return '';
    const tlMap = { zh: 'zh-CN', en: 'en', ms: 'ms' };
    const tl = tlMap[targetLang] || 'en';
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${tl}&dt=t&q=${encodeURIComponent(text)}`;
    const res = await fetch(url);
    const data = await res.json();
    return data[0].map(item => item[0]).join('');
  },
  // 收藏夹本地管理（与 index.html 的 dama_favs 完全互通）
  getFavIds() {
    try {
      return JSON.parse(localStorage.getItem('dama_favs') || '[]');
    } catch (e) {
      return [];
    }
  },
  toggleFavId(id) {
    const numId = Number(id);
    let favs = this.getFavIds();
    if (favs.includes(numId)) {
      favs = favs.filter(i => i !== numId);
    } else {
      favs.push(numId);
    }
    localStorage.setItem('dama_favs', JSON.stringify(favs));
    return favs.includes(numId);
  }
};