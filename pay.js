/* =========================================================
   大马吉通 (DaMaJitong MY) 商业变现与付费置顶模块 pay.js
   ========================================================= */
const DMJT_PAY = {
  // 商业置顶套餐（马币 RM 计价）
  PLANS: [
    { id: 'vip_24h', days: 1, price: 5, zh: '24小时 · 首页黄金置顶', en: '24 Hours · Homepage Top', ms: '24 Jam · Pilihan Utama' },
    { id: 'vip_7d', days: 7, price: 25, zh: '7天 · 爆款引流套餐 (省RM10)', en: '7 Days · Hot Promo (Save RM10)', ms: '7 Hari · Pakej Jimat' },
    { id: 'vip_30d', days: 30, price: 88, zh: '30天 · 认证商家包月尊享', en: '30 Days · Verified Merchant VIP', ms: '30 Hari · VIP Peniaga Sah' }
  ],

  // 站长收款账户信息（支持 DuitNow / TNG eWallet 转账，请替换成你的真实号码）
  RECEIVER: {
    bankName: 'TNG eWallet / DuitNow Transfer',
    accountName: 'DAMAJITONG ENTERPRISE',
    accountNo: '6012-XXXXXXX (请联系客服或扫描 DuitNow QR)',
    adminWhatsapp: '60123456789'
  },

  // 生成付费置顶申请并同步到云端（归类为内部置顶订单，避免前台直接暴露收据）
  async submitTopOrder({ postId, postTitle, planId, payerPhone, receiptUrl }) {
    const plan = this.PLANS.find(p => p.id === planId) || this.PLANS[0];
    const descZh = `关联帖子ID: ${postId}\n购买套餐: ${plan.zh} (${plan.days}天)\n支付金额: RM ${plan.price}\n付款人联系: ${payerPhone}\n状态: 已上传付款凭证，等待站长后台核实置顶。`;
    const orderRecord = {
      category: '置顶订单',
      city: '全马',
      title: `【置顶订单·待核销】${postTitle} (${plan.zh} · RM${plan.price})`,
      title_zh: `【置顶订单·待核销】${postTitle} (${plan.zh} · RM${plan.price})`,
      title_en: `[Pin Order · Pending] ${postTitle} (${plan.en} · RM${plan.price})`,
      title_ms: `[Pesanan Pin · Menunggu] ${postTitle} (${plan.ms} · RM${plan.price})`,
      price: `RM ${plan.price}`,
      price_zh: `RM ${plan.price}`,
      price_en: `RM ${plan.price}`,
      price_ms: `RM ${plan.price}`,
      whatsapp: payerPhone,
      description: descZh,
      desc_zh: descZh,
      desc_en: descZh,
      desc_ms: descZh,
      image_url: receiptUrl || null,
      is_pinned: false
    };

    const { error } = await dmjtSupabase.from('posts').insert([orderRecord]);
    if (error) throw error;
    return plan;
  }
};
