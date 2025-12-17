/**
 * Test 5: crd/rd + product-logs 함께 전송
 *
 * 목적: crd/rd와 product-logs를 함께 전송하면 자동완성 귀속이 더 확실한지 확인
 *
 * 시퀀스:
 * 1. crd/rd 전송 (검색 결과 클릭 추적)
 * 2. product-logs 전송 (상품 조회 로그)
 * 3. 100회 반복
 */

import * as fs from "fs";

const TEST_PRODUCT = {
  keyword: "또봇V",
  query: "또봇v 마스터v",  // URL 인코딩된 검색어
  queryEncoded: "%EB%98%90%EB%B4%87v+%EB%A7%88%EC%8A%A4%ED%84%B0v",
  acq: "또봇V",
  acqEncoded: "%EB%98%90%EB%B4%87V",
  nvMid: "82400534098",
  productId: "4856010799",
  storeUrl: "sd2gb2"
};

const TOTAL_REQUESTS = 100;

interface TestResult {
  round: number;
  ackey: string;
  crd: {
    status: number;
    success: boolean;
  };
  productLogs: {
    status: number;
    success: boolean;
  };
  timestamp: number;
}

// 랜덤 ackey 생성
function generateAckey(): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  for (let i = 0; i < 8; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

// 랜덤 page_uid 생성 (네이버 형식)
function generatePageUid(): string {
  const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let result = "";
  for (let i = 0; i < 24; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

// 랜덤 session key 생성
function generateSessionKey(): string {
  const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let result = "";
  for (let i = 0; i < 24; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

// crd/rd 전송
async function sendCrdRd(params: {
  ackey: string;
  pageUid: string;
  sessionKey: string;
  time: number;
}): Promise<{ status: number; success: boolean }> {
  const { ackey, pageUid, sessionKey, time } = params;

  // crd/rd URL 구성
  const crdParams = new URLSearchParams({
    m: "1",
    px: "206",
    py: "1340",
    sx: "206",
    sy: "449",
    vw: "412",
    vh: "900",
    bw: "412",
    bh: "1784",
    bx: "206",
    by: "1219",
    p: pageUid,
    q: TEST_PRODUCT.query,
    ie: "utf8",
    rev: "1",
    ssc: "tab.m.all",
    f: "m",
    w: "m",
    s: sessionKey,
    time: time.toString(),
    abt: JSON.stringify([
      { eid: "PWL-EVADE-PAP", vid: "12" },
      { eid: "NCO-CARINS3", vid: "3" },
      { eid: "NEW-PLACE-SEARCH", vid: "8" },
      { eid: "NSHP-ORG-RANKING", vid: "21" }
    ]),
    a: "shp_lis.out",
    u: `https://cr3.shopping.naver.com/v2/bridge/searchGate?nv_mid=${TEST_PRODUCT.nvMid}&cat_id=50004210&query=${TEST_PRODUCT.queryEncoded}&t=mj7b1fqm&h=483e96f44f49fe9d724c9720e04234490605a01e&frm=MOSCPRO`,
    r: "7",
    i: "00000009_00132f745e52",
    cr: "1"
  });

  const crdUrl = `https://m.search.naver.com/p/crd/rd?${crdParams.toString()}`;

  // referer에 자동완성 파라미터 포함
  const referer = `https://m.search.naver.com/search.naver?sm=mtp_sug.top&where=m&query=${TEST_PRODUCT.queryEncoded}&ackey=${ackey}&acq=${TEST_PRODUCT.acqEncoded}&acr=5&qdt=0`;

  try {
    const response = await fetch(crdUrl, {
      method: "POST",
      headers: {
        "accept": "*/*",
        "origin": "https://m.search.naver.com",
        "referer": referer,
        "user-agent": "Mozilla/5.0 (Linux; Android 13; SM-S911N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
        "sec-ch-ua-mobile": "?1",
        "sec-ch-ua-platform": "\"Android\""
      }
    });

    return {
      status: response.status,
      success: response.ok
    };
  } catch (error) {
    return {
      status: 0,
      success: false
    };
  }
}

// product-logs 전송
async function sendProductLogs(params: {
  ackey: string;
  pageUid: string;
}): Promise<{ status: number; success: boolean }> {
  const { ackey, pageUid } = params;

  const referer = `https://m.search.naver.com/search.naver?sm=mtp_sug.top&where=m&query=${TEST_PRODUCT.queryEncoded}&ackey=${ackey}&acq=${TEST_PRODUCT.acqEncoded}&acr=5&qdt=0`;

  const body = {
    id: TEST_PRODUCT.productId,
    channel: {
      accountNo: 100425708,
      channelNo: "100469114",
      channelUid: "2sWDy5uNvjYrer3SMDoBT",
      channelName: "새똥이꿀복이",
      representName: "효성사",
      channelSiteUrl: TEST_PRODUCT.storeUrl,
      channelSiteFullUrl: `https://smartstore.naver.com/${TEST_PRODUCT.storeUrl}`,
      channelSiteMobileUrl: `https://m.smartstore.naver.com/${TEST_PRODUCT.storeUrl}`,
      accountId: "ncp_1nsgz0_01",
      naverPaySellerNo: "510435604",
      sellerExternalStatusType: "NORMAL",
      logoWidth: 511,
      logoHeight: 511,
      logoUrl: "http://shop1.phinf.naver.net/20200311_96/1583898878474GOfOT_PNG/21259617107392651_1924964452.png",
      channelTypeCode: "STOREFARM"
    },
    channelServiceType: "STOREFARM",
    category: {
      categoryId: "50004210",
      categoryName: "로봇",
      category1Id: "50000005",
      category2Id: "50000142",
      category3Id: "50001154",
      category4Id: "50004210",
      category1Name: "출산/육아",
      category2Name: "완구/인형",
      category3Name: "작동완구",
      category4Name: "로봇",
      wholeCategoryId: "50000005>50000142>50001154>50004210",
      wholeCategoryName: "출산/육아>완구/인형>작동완구>로봇",
      categoryLevel: 4,
      lastLevel: true,
      sortOrder: 1,
      validCategory: true,
      receiptIssue: true,
      exceptionalCategoryTypes: [
        "REGULAR_SUBSCRIPTION",
        "MANUFACTURE_DEFINE_NO",
        "CHILD_CERTIFICATION",
        "FREE_RETURN_INSURANCE"
      ],
      pointAccumulationYn: false
    },
    groupId: null,
    tr: "sls",
    planNo: "",
    referer: referer
  };

  const pageReferer = `https://m.smartstore.naver.com/${TEST_PRODUCT.storeUrl}/products/${TEST_PRODUCT.productId}?nl-query=${TEST_PRODUCT.queryEncoded}&nl-ts-pid=${pageUid}`;

  try {
    const response = await fetch(
      `https://m.smartstore.naver.com/i/v1/product-logs/${TEST_PRODUCT.productId}`,
      {
        method: "POST",
        headers: {
          "accept": "application/json",
          "content-type": "application/json",
          "origin": "https://m.smartstore.naver.com",
          "referer": pageReferer,
          "user-agent": "Mozilla/5.0 (Linux; Android 13; SM-S911N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
          "useshopfegw": "true",
          "x-client-version": "20251215150000"
        },
        body: JSON.stringify(body)
      }
    );

    return {
      status: response.status,
      success: response.ok
    };
  } catch (error) {
    return {
      status: 0,
      success: false
    };
  }
}

async function runTest5() {
  console.log("=== Test 5: crd/rd + product-logs 함께 전송 ===\n");
  console.log(`상품: ${TEST_PRODUCT.keyword}`);
  console.log(`MID: ${TEST_PRODUCT.nvMid}`);
  console.log(`Product ID: ${TEST_PRODUCT.productId}`);
  console.log(`총 요청: ${TOTAL_REQUESTS}회\n`);

  const results: TestResult[] = [];
  let crdSuccess = 0;
  let productLogsSuccess = 0;
  let bothSuccess = 0;

  for (let i = 1; i <= TOTAL_REQUESTS; i++) {
    const ackey = generateAckey();
    const pageUid = generatePageUid();
    const sessionKey = generateSessionKey();
    const time = Date.now();

    // 1. crd/rd 전송
    const crdResult = await sendCrdRd({ ackey, pageUid, sessionKey, time });

    // 약간의 딜레이 (실제 사용자 행동 모방)
    await new Promise(r => setTimeout(r, 100));

    // 2. product-logs 전송
    const productLogsResult = await sendProductLogs({ ackey, pageUid });

    const result: TestResult = {
      round: i,
      ackey,
      crd: crdResult,
      productLogs: productLogsResult,
      timestamp: time
    };

    results.push(result);

    if (crdResult.success) crdSuccess++;
    if (productLogsResult.success) productLogsSuccess++;
    if (crdResult.success && productLogsResult.success) bothSuccess++;

    // 진행 상황 출력
    const crdStatus = crdResult.success ? "✅" : "❌";
    const plStatus = productLogsResult.success ? "✅" : "❌";
    process.stdout.write(`\r[${i}/${TOTAL_REQUESTS}] crd:${crdStatus}(${crdResult.status}) pl:${plStatus}(${productLogsResult.status}) | ackey: ${ackey}`);

    // 요청 간 딜레이
    await new Promise(r => setTimeout(r, 200));
  }

  console.log("\n\n========================================");
  console.log("=== Test 5 결과 ===");
  console.log("========================================\n");

  console.log(`crd/rd 성공: ${crdSuccess}/${TOTAL_REQUESTS} (${(crdSuccess/TOTAL_REQUESTS*100).toFixed(1)}%)`);
  console.log(`product-logs 성공: ${productLogsSuccess}/${TOTAL_REQUESTS} (${(productLogsSuccess/TOTAL_REQUESTS*100).toFixed(1)}%)`);
  console.log(`둘 다 성공: ${bothSuccess}/${TOTAL_REQUESTS} (${(bothSuccess/TOTAL_REQUESTS*100).toFixed(1)}%)`);

  // 결과 저장
  const summary = {
    test: "Test 5: crd/rd + product-logs",
    product: TEST_PRODUCT,
    totalRequests: TOTAL_REQUESTS,
    results: {
      crd: {
        success: crdSuccess,
        fail: TOTAL_REQUESTS - crdSuccess,
        rate: (crdSuccess / TOTAL_REQUESTS * 100).toFixed(1) + "%"
      },
      productLogs: {
        success: productLogsSuccess,
        fail: TOTAL_REQUESTS - productLogsSuccess,
        rate: (productLogsSuccess / TOTAL_REQUESTS * 100).toFixed(1) + "%"
      },
      both: {
        success: bothSuccess,
        fail: TOTAL_REQUESTS - bothSuccess,
        rate: (bothSuccess / TOTAL_REQUESTS * 100).toFixed(1) + "%"
      }
    },
    timestamp: new Date().toISOString(),
    details: results
  };

  const filename = `scripts/ackey-test/results/test5_${new Date().toISOString().split("T")[0]}.json`;
  fs.writeFileSync(filename, JSON.stringify(summary, null, 2), "utf-8");
  console.log(`\n결과 저장: ${filename}`);
}

runTest5();
