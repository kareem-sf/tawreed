// Work-package taxonomy — bilingual keyword dictionaries for the heuristic classifier.
import type { WorkPackageDef } from '../../shared/types';
import { normalizeText } from '../normalize';

const defs: Array<Omit<WorkPackageDef, 'keywords'> & { keywords: string[] }> = [
  {
    code: 'WP-01', nameEn: 'Site Preparation & Earthworks', nameAr: 'تجهيز الموقع وأعمال الحفر',
    keywords: ['excavation', 'backfill', 'earthwork', 'site clearance', 'grading', 'compaction', 'dewatering',
      'حفر', 'ردم', 'تسويه', 'دمك', 'نزح', 'تجهيز الموقع', 'ازاله', 'إزاله'],
  },
  {
    code: 'WP-02', nameEn: 'Concrete & Reinforcement Works', nameAr: 'أعمال الخرسانة والتسليح',
    keywords: ['concrete', 'rebar', 'reinforcement', 'formwork', 'screed', 'blinding', 'post-tension', 'precast',
      'خرسانه', 'خرسانة', 'حديد', 'تسليح', 'شده', 'شدة', 'مباني', 'سكريد', 'فرمه', 'صب'],
  },
  {
    code: 'WP-03', nameEn: 'Masonry & Block Works', nameAr: 'أعمال المباني',
    keywords: ['block', 'masonry', 'brick', 'aac', 'بلوك', 'طوب', 'مباني', 'مونه', 'مونة'],
  },
  {
    code: 'WP-04', nameEn: 'Plaster & Finishes', nameAr: 'أعمال التشطيبات',
    keywords: ['plaster', 'paint', 'flooring', 'tile', 'porcelain', 'marble', 'granite', 'ceiling', 'gypsum',
      'skirting', 'epoxy', 'screed finish', 'محاره', 'لياسه', 'دهان', 'ارضيات', 'بلاط', 'سيراميك', 'بورسلين',
      'رخام', 'جرانيت', 'اسقف', 'جبس', 'وزره', 'ايبوكسي'],
  },
  {
    code: 'WP-05', nameEn: 'Doors, Windows & Glazing', nameAr: 'الأبواب والنوافذ والواجهات',
    keywords: ['door', 'window', 'glazing', 'curtain wall', 'aluminium', 'aluminum', 'shutter', 'باب', 'ابواب',
      'شباك', 'نوافذ', 'واجهات', 'الوميتال', 'زجاج', 'كرترن'],
  },
  {
    code: 'WP-06', nameEn: 'Waterproofing & Insulation', nameAr: 'أعمال العزل',
    keywords: ['waterproof', 'membrane', 'insulation', 'bituminous', 'xps', 'epdm', 'عزل', 'بيتومين', 'لفائف', 'رولات'],
  },
  {
    code: 'WP-07', nameEn: 'Plumbing & Fire Fighting', nameAr: 'أعمال السباكة والإطفاء',
    keywords: ['plumbing', 'drainage', 'ppr', 'upvc', 'sanitary', 'pump', 'fire fighting', 'hydrant', 'hose reel',
      'sprinkler', 'سباكه', 'صرف', 'تغذيه', 'اطفاء', 'حريق', 'مضخه', 'طلمبه', 'حنفيه', 'مرشات'],
  },
  {
    code: 'WP-08', nameEn: 'HVAC Works', nameAr: 'أعمال التكييف والتهوية',
    keywords: ['hvac', 'air conditioning', 'duct', 'chiller', 'ahu', 'fcu', 'vrf', 'ventilation', 'diffuser', 'grille',
      'تكييف', 'تهويه', 'دكت', 'شيلر', 'مكيف', 'فريون', 'جريلات'],
  },
  {
    code: 'WP-09', nameEn: 'Electrical & Low Current', nameAr: 'الأعمال الكهربائية والتيار الخفيف',
    keywords: ['electrical', 'cable', 'cabling', 'wiring', 'lighting', 'earthing', 'lightning', 'distribution board', 'generator',
      'fire alarm', 'bms', 'cctv', 'كابل', 'كابلات', 'كهرباء', 'كهربا', 'اناره', 'اضاءه', 'لوحه', 'مولد', 'انذار', 'تايرد'],
  },
  {
    code: 'WP-10', nameEn: 'External Works & Landscaping', nameAr: 'الأعمال الخارجية والتنسيق',
    keywords: ['paving', 'landscape', 'fence', 'gate', 'road', 'asphalt', 'interlock', 'انترلوك', 'اسفلت', 'سور', 'بوابه', 'لاندسكيب', 'زراعه'],
  },
];

export const TAXONOMY: WorkPackageDef[] = defs.map((d) => ({
  ...d,
  keywords: d.keywords.map(normalizeText),
}));

export const UNCLASSIFIED = { code: 'WP-99', nameEn: 'Unclassified', nameAr: 'غير مصنف' };
