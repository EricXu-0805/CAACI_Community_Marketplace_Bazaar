-- Folding every keyword on every moderated field was dominated by SQL
-- function entry/search_path setup. Keep the exact translation, but make the
-- pure scalar helper eligible for inlining. No table, keyword or policy changes.
-- Every called object is pg_catalog-qualified; the mapping uses two literals
-- rather than caller-resolved concatenation operators. SECURITY INVOKER stays.
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='30s';
DO $guard$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc WHERE oid='public.content_moderation_fold_han(text)'::regprocedure
    AND NOT prosecdef AND provolatile='i' AND prolang=(SELECT oid FROM pg_catalog.pg_language WHERE lanname='sql'))
  THEN RAISE EXCEPTION 'moderation_fold_contract_drift'; END IF;
END $guard$;
CREATE OR REPLACE FUNCTION public.content_moderation_fold_han(raw text)
RETURNS text LANGUAGE sql IMMUTABLE SECURITY INVOKER
AS $fold$
  SELECT pg_catalog.translate(COALESCE(raw, ''),
    '寫購職單結過證辦開發貸網絡賣買錢幣匯換學業專論試題課師導輔賬號聯繫話電機價優團幫們這說對時間為從與個麼沒還會見現兒邊進遠選車門問長頭點級經線給資產貨賺費錄詳諮詢認執駕護簽註冊賠償額銀帳戶兌藥槍賭詐騙廣傳銷補習畢圖書腦碼郵顧譜誠質當無轉歡談讓條應該東華國漢語稱標準節樂醫',
    '写购职单结过证办开发贷网络卖买钱币汇换学业专论试题课师导辅账号联系话电机价优团帮们这说对时间为从与个么没还会见现儿边进远选车门问长头点级经线给资产货赚费录详咨询认执驾护签注册赔偿额银帐户兑药枪赌诈骗广传销补习毕图书脑码邮顾谱诚质当无转欢谈让条应该东华国汉语称标准节乐医');
$fold$;
NOTIFY pgrst, 'reload schema';
