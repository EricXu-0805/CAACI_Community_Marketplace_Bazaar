// A dependency module runs before its importers' bodies. Installing inside
// useSupabase's body was too late for imported URL validators to initialize.
// #ifdef MP-WEIXIN || MP-QQ || MP-BAIDU || MP-ALIPAY || MP-TOUTIAO
import { installUrlShim } from './urlShim'
installUrlShim()
// #endif
export {}
