// Versioned, bilingual construction knowledge pack for deterministic offline grouping.
import type { WorkPackageDef } from '../../shared/types';
import { normalizeText } from '../normalize';

export const KNOWLEDGE_PACK_VERSION = 2;

const defs: WorkPackageDef[] = [
  {
    code: 'WP-PRELIMINARIES', nameEn: 'Preliminaries & General Requirements', nameAr: 'الأعمال التمهيدية والمتطلبات العامة',
    keywords: ['preliminaries', 'general requirements', 'mobilization', 'temporary works', 'site office', 'hoarding', 'permits', 'insurance', 'shop drawings', 'as built', 'method statement', 'welfare facilities', 'تمهيدات', 'تجهيزات الموقع', 'مكاتب الموقع', 'سور مؤقت', 'تصاريح', 'مخططات تنفيذية', 'رسومات تنفيذية', 'كما تم التنفيذ'],
  },
  {
    code: 'WP-DEMOLITION', nameEn: 'Demolition & Strip-Out Works', nameAr: 'أعمال الهدم والإزالة',
    keywords: ['demolition', 'strip out', 'dismantle', 'breaking out', 'remove existing', 'disposal', 'cart away', 'هدم', 'تكسير', 'فك وازالة', 'فك وإزالة', 'ازالة القائم', 'إزالة القائم', 'نقل المخلفات'],
    negativeKeywords: ['removable partition'],
  },
  {
    code: 'WP-01', nameEn: 'Earthworks & Site Preparation', nameAr: 'الأعمال الترابية وتجهيز الموقع',
    keywords: ['excavation', 'backfill', 'earthwork', 'site clearance', 'grading', 'compaction', 'dewatering', 'trench', 'selected fill', 'حفر', 'ردم', 'تسويه', 'تسوية', 'دمك', 'نزح', 'تجهيز الموقع', 'إحلال'],
    unitSignals: ['m3'],
  },
  {
    code: 'WP-PILING', nameEn: 'Piling & Ground Improvement', nameAr: 'الخوازيق وتحسين التربة',
    keywords: ['piling', 'bored pile', 'micro pile', 'sheet pile', 'secant pile', 'soil improvement', 'stone column', 'خوازيق', 'خازوق', 'ستائر لوحية', 'تحسين التربة', 'حقن التربة'],
    priority: 3,
  },
  {
    code: 'WP-02', nameEn: 'Concrete & Reinforcement Works', nameAr: 'أعمال الخرسانة والتسليح',
    keywords: ['concrete', 'rebar', 'reinforcement', 'formwork', 'blinding', 'post tension', 'precast', 'rc slab', 'rc beam', 'rc column', 'خرسانه', 'خرسانة', 'حديد تسليح', 'تسليح', 'شده خشبية', 'شدة خشبية', 'صب', 'سابق الصب'],
    negativeKeywords: ['concrete block', 'بلوك خرساني'],
    unitSignals: ['m3', 'kg', 'ton'],
  },
  {
    code: 'WP-STRUCTURAL-STEEL', nameEn: 'Structural Steel Works', nameAr: 'أعمال المنشآت المعدنية',
    keywords: ['structural steel', 'steel frame', 'steel beam', 'steel column', 'space frame', 'metal deck', 'purlin', 'truss', 'منشآت معدنية', 'هيكل معدني', 'كمرات معدنية', 'جمالون', 'صاج مفرغ'],
    negativeKeywords: ['reinforcement', 'حديد تسليح', 'stainless steel sink'],
    unitSignals: ['kg', 'ton'],
  },
  {
    code: 'WP-03', nameEn: 'Masonry & Block Works', nameAr: 'أعمال المباني والبلوك',
    keywords: ['blockwork', 'concrete block', 'cement block', 'masonry', 'brickwork', 'aac block', 'hollow block', 'solid block', 'بلوك', 'طوب', 'مباني', 'مونة مباني', 'بلوك خرساني', 'طوب أسمنتي'],
    negativeKeywords: ['glass block window'],
    unitSignals: ['m2'],
  },
  {
    code: 'WP-WATERPROOFING', nameEn: 'Waterproofing Works', nameAr: 'أعمال العزل المائي',
    keywords: ['waterproofing', 'waterproof', 'bituminous membrane', 'torch applied', 'liquid membrane', 'epdm membrane', 'pvc membrane', 'tank lining', 'عزل مائي', 'بيتومين', 'لفائف عزل', 'ممبرين', 'دهان عازل'],
  },
  {
    code: 'WP-INSULATION', nameEn: 'Thermal & Fire Insulation', nameAr: 'العزل الحراري ومقاومة الحريق',
    keywords: ['thermal insulation', 'rock wool', 'mineral wool', 'glass wool', 'xps', 'eps insulation', 'pir insulation', 'fire stopping', 'firestop', 'عزل حراري', 'صوف صخري', 'صوف زجاجي', 'فواصل حريق', 'مانع حريق'],
    negativeKeywords: ['waterproof'],
  },
  {
    code: 'WP-ROOFING', nameEn: 'Roofing Works', nameAr: 'أعمال الأسطح والتغطيات',
    keywords: ['roofing', 'roof tile', 'standing seam', 'roof sheet', 'rooflight', 'skylight', 'coping', 'تغطية أسطح', 'قرميد', 'صاج معرج', 'سكاي لايت', 'كوبينج'],
  },
  {
    code: 'WP-FACADE', nameEn: 'Facades & Curtain Wall', nameAr: 'أعمال الواجهات والستائر الزجاجية',
    keywords: ['curtain wall', 'unitized facade', 'facade cladding', 'aluminium composite panel', 'aluminum composite panel', 'acp cladding', 'spider glazing', 'structural glazing', 'louvers', 'واجهات زجاجية', 'كرتن وول', 'كلادينج', 'واجهات ألمنيوم', 'لوفرات'],
  },
  {
    code: 'WP-05', nameEn: 'Doors, Windows & Glazing', nameAr: 'الأبواب والنوافذ والزجاج',
    keywords: ['door', 'window', 'glazing', 'glass partition', 'aluminium window', 'aluminum window', 'roller shutter', 'ironmongery', 'hardware set', 'باب', 'ابواب', 'أبواب', 'شباك', 'نوافذ', 'زجاج', 'الوميتال', 'ألومنيوم', 'اكسسوارات ابواب'],
    negativeKeywords: ['curtain wall', 'fire damper', 'access door duct'],
  },
  {
    code: 'WP-PLASTER', nameEn: 'Plastering & Rendering', nameAr: 'أعمال المحارة واللياسة',
    keywords: ['plastering', 'cement plaster', 'rendering', 'stucco', 'skim coat', 'محاره', 'محارة', 'لياسه', 'لياسة', 'بياض محارة', 'ضهارة'],
    unitSignals: ['m2'],
  },
  {
    code: 'WP-PAINT', nameEn: 'Painting & Protective Coatings', nameAr: 'أعمال الدهانات والطلاءات',
    keywords: ['painting', 'paint finish', 'emulsion paint', 'acrylic paint', 'epoxy paint', 'protective coating', 'intumescent paint', 'دهان', 'دهانات', 'طلاء', 'دوكو', 'بلاستيك مط'],
    negativeKeywords: ['road marking', 'علامات الطرق'],
  },
  {
    code: 'WP-FLOOR-TILES', nameEn: 'Tiles & Ceramic Finishes', nameAr: 'أعمال البلاط والسيراميك',
    keywords: ['ceramic tile', 'porcelain tile', 'floor tile', 'wall tile', 'mosaic tile', 'tile adhesive', 'grout', 'سيراميك', 'بورسلين', 'بلاط', 'موزايكو', 'مونة لصق', 'ترويبة'],
    negativeKeywords: ['roof tile', 'ceiling tile'],
    unitSignals: ['m2'],
  },
  {
    code: 'WP-STONE', nameEn: 'Natural Stone & Terrazzo', nameAr: 'أعمال الرخام والجرانيت والحجر',
    keywords: ['marble', 'granite', 'natural stone', 'limestone', 'terrazzo', 'quartz stone', 'رخام', 'جرانيت', 'حجر طبيعي', 'تيرازو', 'كوارتز'],
    unitSignals: ['m2'],
  },
  {
    code: 'WP-RESILIENT-FLOORING', nameEn: 'Resilient, Carpet & Raised Flooring', nameAr: 'أعمال الأرضيات المرنة والموكيت والمرتفعة',
    keywords: ['vinyl flooring', 'lvt', 'spc flooring', 'rubber flooring', 'carpet tile', 'carpet', 'raised floor', 'access floor', 'ارضيات فينيل', 'أرضيات فينيل', 'موكيت', 'ارضية مرتفعة', 'أرضية مرتفعة', 'مطاط'],
  },
  {
    code: 'WP-CEILINGS', nameEn: 'Suspended Ceilings', nameAr: 'أعمال الأسقف المعلقة',
    keywords: ['suspended ceiling', 'gypsum ceiling', 'acoustic ceiling tile', 'metal ceiling', 'baffle ceiling', 'grid ceiling', 'اسقف معلقة', 'أسقف معلقة', 'سقف جبس', 'بلاطات سقف', 'سقف معدني'],
    negativeKeywords: ['gypsum partition'],
  },
  {
    code: 'WP-PARTITIONS', nameEn: 'Partitions & Drywall', nameAr: 'أعمال القواطيع والجبس بورد',
    keywords: ['gypsum partition', 'drywall partition', 'stud partition', 'demountable partition', 'cement board partition', 'قواطيع جبس', 'حوائط جبس', 'جبس بورد', 'قاطع متحرك', 'قواطيع أسمنت بورد'],
  },
  {
    code: 'WP-JOINERY', nameEn: 'Joinery & Millwork', nameAr: 'أعمال النجارة والديكورات الخشبية',
    keywords: ['joinery', 'millwork', 'wood paneling', 'timber cladding', 'built in cabinet', 'wardrobe', 'vanity unit', 'kitchen cabinet', 'نجارة', 'كسوة خشب', 'دواليب', 'خزائن', 'وحدات مطبخ', 'كونتر خشبي'],
    negativeKeywords: ['timber door'],
  },
  {
    code: 'WP-SIGNAGE', nameEn: 'Signage & Wayfinding', nameAr: 'أعمال اللافتات والإرشاد',
    keywords: ['signage', 'wayfinding', 'directional sign', 'room sign', 'building sign', 'لافتات', 'لوحات ارشادية', 'لوحات إرشادية', 'ترقيم الغرف', 'توجيه'],
  },
  {
    code: 'WP-FFE', nameEn: 'Furniture, Fixtures & Equipment', nameAr: 'الأثاث والتجهيزات والمعدات',
    keywords: ['loose furniture', 'office furniture', 'workstation', 'seating', 'tables and chairs', 'ffe', 'ff&e', 'اثاث', 'أثاث', 'مكاتب وكراسي', 'تجهيزات مكتبية'],
  },
  {
    code: 'WP-ELEVATORS', nameEn: 'Elevators & Escalators', nameAr: 'المصاعد والسلالم المتحركة',
    keywords: ['elevator', 'lift installation', 'escalator', 'dumbwaiter', 'moving walkway', 'مصعد', 'مصاعد', 'اسانسير', 'سلم متحرك', 'رافعة طعام'],
  },
  {
    code: 'WP-07', nameEn: 'Plumbing & Drainage', nameAr: 'أعمال السباكة والصرف',
    keywords: ['plumbing', 'drainage', 'ppr pipe', 'upvc pipe', 'hdpe pipe', 'sanitary fixture', 'water supply', 'sewage', 'sump pump', 'booster pump', 'سباكه', 'سباكة', 'صرف صحي', 'تغذيه مياه', 'تغذية مياه', 'أدوات صحية', 'مواسير بي بي آر', 'طلمبة رفع'],
    negativeKeywords: ['fire pump', 'sprinkler'],
  },
  {
    code: 'WP-FIRE-FIGHTING', nameEn: 'Fire Fighting Systems', nameAr: 'أنظمة مكافحة الحريق',
    keywords: ['fire fighting', 'firefighting', 'sprinkler', 'fire pump', 'hydrant', 'hose reel', 'fire suppression', 'fm200', 'novec', 'مكافحة الحريق', 'اطفاء', 'إطفاء', 'مرشات حريق', 'حنفية حريق', 'خراطيم حريق', 'طلمبات حريق'],
    negativeKeywords: ['fire alarm', 'انذار حريق', 'إنذار حريق'],
  },
  {
    code: 'WP-08', nameEn: 'HVAC & Ventilation', nameAr: 'أعمال التكييف والتهوية',
    keywords: ['hvac', 'air conditioning', 'ductwork', 'chiller', 'ahu', 'fcu', 'vrf', 'ventilation', 'diffuser', 'grille', 'exhaust fan', 'copper refrigerant pipe', 'تكييف', 'تهويه', 'تهوية', 'دكت', 'شيلر', 'وحدة مناولة', 'فان كويل', 'جريلات', 'مراوح شفط'],
  },
  {
    code: 'WP-09', nameEn: 'Electrical Power & Lighting', nameAr: 'أعمال القوى والإنارة',
    keywords: ['electrical works', 'power cable', 'power cabling', 'lv cable', 'cable tray', 'wiring', 'lighting fixture', 'distribution board', 'switchgear', 'transformer', 'generator', 'earthing', 'lightning protection', 'كابلات قوى', 'كهرباء', 'كهربا', 'اناره', 'إنارة', 'اضاءه', 'إضاءة', 'لوحة توزيع', 'محول', 'مولد', 'تأريض', 'مانعة صواعق'],
    negativeKeywords: ['data cable', 'fire alarm cable', 'fiber optic'],
  },
  {
    code: 'WP-FIRE-ALARM', nameEn: 'Fire Alarm System', nameAr: 'نظام إنذار الحريق',
    keywords: ['fire alarm', 'smoke detector', 'heat detector', 'manual call point', 'fire alarm panel', 'sounder beacon', 'انذار حريق', 'إنذار حريق', 'كاشف دخان', 'كاشف حرارة', 'نقطة نداء', 'لوحة انذار'],
  },
  {
    code: 'WP-ICT', nameEn: 'ICT, Data & Telecom', nameAr: 'أنظمة البيانات والاتصالات',
    keywords: ['structured cabling', 'data outlet', 'cat6', 'cat 6', 'fiber optic', 'telephone system', 'wifi access point', 'server rack', 'شبكة بيانات', 'نقطة داتا', 'كابل فايبر', 'هاتف', 'راك شبكات', 'واي فاي'],
  },
  {
    code: 'WP-SECURITY', nameEn: 'CCTV & Access Control', nameAr: 'أنظمة المراقبة والتحكم بالدخول',
    keywords: ['cctv', 'security camera', 'access control', 'card reader', 'door contact', 'intrusion alarm', 'turnstile', 'كاميرات مراقبة', 'تحكم دخول', 'قارئ كروت', 'بوابة دخول', 'انذار اقتحام'],
  },
  {
    code: 'WP-BMS', nameEn: 'Building Management System', nameAr: 'نظام إدارة المبنى',
    keywords: ['building management system', 'bms system', 'bms controller', 'ddc panel', 'building automation', 'نظام ادارة المبنى', 'نظام إدارة المبنى', 'تحكم مركزي', 'لوحة دي دي سي'],
  },
  {
    code: 'WP-GAS', nameEn: 'Gas Systems', nameAr: 'أنظمة الغاز',
    keywords: ['natural gas', 'lpg system', 'gas pipe', 'medical gas', 'compressed air piping', 'شبكة غاز', 'غاز طبيعي', 'غاز مسال', 'غازات طبية', 'هواء مضغوط'],
  },
  {
    code: 'WP-UTILITIES', nameEn: 'External Utilities', nameAr: 'شبكات المرافق الخارجية',
    keywords: ['external utilities', 'storm water network', 'sewer network', 'potable water network', 'irrigation network', 'manhole', 'شبكات خارجية', 'شبكة صرف', 'شبكة مياه', 'صرف امطار', 'صرف أمطار', 'غرف تفتيش', 'شبكة ري'],
    negativeKeywords: ['internal drainage'],
  },
  {
    code: 'WP-ROADS', nameEn: 'Roads, Paving & External Hardscape', nameAr: 'أعمال الطرق والرصف',
    keywords: ['roadworks', 'asphalt', 'road base', 'subbase', 'kerbstone', 'interlock paving', 'road marking', 'bollard', 'اسفلت', 'أسفلت', 'طبقة اساس', 'طبقة أساس', 'بردورة', 'انترلوك', 'بلاط ارصفة', 'علامات الطرق'],
  },
  {
    code: 'WP-10', nameEn: 'Landscaping & Irrigation', nameAr: 'أعمال تنسيق الموقع والري',
    keywords: ['landscaping', 'softscape', 'planting', 'trees and shrubs', 'topsoil', 'irrigation system', 'لاندسكيب', 'تنسيق الموقع', 'زراعه', 'زراعة', 'أشجار', 'تربة زراعية', 'شبكة ري'],
    negativeKeywords: ['irrigation network external utility'],
  },
  {
    code: 'WP-ACOUSTIC', nameEn: 'Acoustic Treatments', nameAr: 'المعالجات الصوتية',
    keywords: ['acoustic panel', 'acoustic wall', 'sound absorption', 'soundproofing', 'fabric wrapped panel', 'ألواح صوتية', 'معالجة صوتية', 'عزل صوتي', 'امتصاص الصوت'],
    negativeKeywords: ['acoustic ceiling tile'],
  },
  {
    code: 'WP-KITCHEN', nameEn: 'Commercial Kitchen & Laundry Equipment', nameAr: 'معدات المطابخ والمغاسل',
    keywords: ['commercial kitchen equipment', 'kitchen equipment', 'laundry equipment', 'cold room', 'walk in freezer', 'معدات مطابخ', 'معدات مغسلة', 'غرفة تبريد', 'ثلاجات صناعية'],
    negativeKeywords: ['kitchen cabinet'],
  },
  {
    code: 'WP-POOL', nameEn: 'Swimming Pools & Water Features', nameAr: 'حمامات السباحة والنوافير',
    keywords: ['swimming pool', 'pool filtration', 'water feature', 'fountain equipment', 'jacuzzi', 'حمام سباحة', 'فلترة المسبح', 'نافورة', 'شلال مائي', 'جاكوزي'],
  },
  {
    code: 'WP-CLEANING', nameEn: 'Final Cleaning', nameAr: 'أعمال النظافة النهائية',
    keywords: ['final cleaning', 'builders clean', 'deep cleaning', 'handover cleaning', 'تنظيف نهائي', 'نظافة نهائية', 'تنظيف عميق', 'نظافة التسليم'],
  },
  {
    code: 'WP-COMMISSIONING', nameEn: 'Testing, Commissioning & Handover', nameAr: 'الاختبارات والتشغيل والتسليم',
    keywords: ['testing and commissioning', 'commissioning', 'test and balance', 'tab works', 'integrated systems testing', 'training and handover', 'اختبارات وتشغيل', 'تشغيل تجريبي', 'اختبار وموازنة', 'تدريب وتسليم'],
  },
  {
    code: 'WP-SPECIALIST', nameEn: 'Specialist Systems', nameAr: 'الأنظمة التخصصية',
    keywords: ['specialist system', 'clean room', 'laboratory equipment', 'theatre equipment', 'av system', 'audio visual', 'sports equipment', 'أنظمة تخصصية', 'غرف نظيفة', 'معدات مختبرات', 'معدات مسرح', 'نظام سمعي بصري'],
  },
];

const normalizeList = (values: string[] | undefined) =>
  values?.map(normalizeText).filter(Boolean);

export const TAXONOMY: WorkPackageDef[] = defs.map((definition) => ({
  ...definition,
  keywords: normalizeList(definition.keywords) ?? [],
  negativeKeywords: normalizeList(definition.negativeKeywords),
}));

export const UNCLASSIFIED = {
  code: 'WP-99',
  nameEn: 'Unclassified',
  nameAr: 'غير مصنف',
};
