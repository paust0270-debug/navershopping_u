#!/usr/bin/env npx tsx
/**
 * CAPTCHA 테스트 - puppeteer-real-browser 버전
 *
 * PRB는 봇 탐지 우회 기능이 내장되어 있어 CAPTCHA 발생률이 낮음
 */

import * as dotenv from "dotenv";
dotenv.config();

import { connect } from "puppeteer-real-browser";
import type { Page } from "rebrowser-puppeteer-core";
import Anthropic from "@anthropic-ai/sdk";

async function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}

function randomDelay(min: number, max: number): Promise<void> {
  const ms = Math.floor(Math.random() * (max - min + 1)) + min;
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Claude Vision으로 CAPTCHA 해결
async function solveCaptchaWithVision(page: Page, question: string): Promise<string | null> {
  const anthropic = new Anthropic();

  try {
    // 영수증 이미지 캡처
    const imageElement = await page.$("#rcpt_img") ||
                         await page.$(".captcha_img") ||
                         await page.$('img[alt="캡차이미지"]');

    if (!imageElement) {
      console.log("[Vision] 영수증 이미지 요소 없음, 전체 페이지 캡처");
    }

    const screenshot = imageElement
      ? await imageElement.screenshot({ encoding: "base64" })
      : await page.screenshot({ encoding: "base64" });

    const hasValidQuestion = question.length > 0 && question.length < 200 &&
      (question.includes("무엇입니까") || question.includes("[?]") ||
       question.includes("번째") || question.includes("빈 칸"));

    const prompt = hasValidQuestion
      ? `이 영수증 CAPTCHA 이미지를 보고 다음 질문에 답하세요.

질문: ${question}

영수증에서 해당 정보를 찾아 [?] 위치에 들어갈 답만 정확히 알려주세요.
- "번째 숫자는 무엇입니까" 형식이면: 영수증에서 해당 숫자를 찾아 답하세요
- 주소 관련이면: 번지수나 도로명 번호만 (예: "794")
- 전화번호 관련이면: 해당 숫자만 (예: "5678")

다른 설명 없이 답만 출력하세요.`
      : `이 이미지는 네이버 보안 확인(CAPTCHA) 페이지입니다.

이미지에서:
1. 질문을 찾으세요 (예: "가게 전화번호의 뒤에서 1번째 숫자는 무엇입니까?")
2. 영수증 이미지에서 해당 정보를 찾으세요
3. 정답만 출력하세요

다른 설명 없이 정답만 출력하세요 (숫자 하나 또는 짧은 텍스트).`;

    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 50,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: "image/png",
                data: screenshot as string,
              },
            },
            { type: "text", text: prompt },
          ],
        },
      ],
    });

    const content = response.content[0];
    if (content.type === "text") {
      let answer = content.text.trim();
      answer = answer.replace(/입니다\.?$/, "").trim();
      answer = answer.replace(/^답\s*:\s*/i, "").trim();
      return answer;
    }
  } catch (error: any) {
    console.error("[Vision] Error:", error.message);
  }

  return null;
}

// 사람처럼 타이핑
async function humanType(page: Page, selector: string, text: string): Promise<void> {
  await page.click(selector);
  await randomDelay(100, 300);

  for (const char of text) {
    await page.keyboard.type(char);
    await randomDelay(50, 150);
  }

  await randomDelay(200, 400);
}

async function main() {
  console.log("========================================");
  console.log("  CAPTCHA 테스트 (puppeteer-real-browser)");
  console.log("========================================\n");

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("❌ ANTHROPIC_API_KEY 환경변수 필요!");
    process.exit(1);
  }
  console.log("✅ ANTHROPIC_API_KEY 설정됨\n");

  // PRB로 브라우저 실행
  console.log("[1] PRB 브라우저 실행...");
  const { browser, page } = await connect({
    headless: false,
    turnstile: true,
    fingerprint: true,
    args: ["--disable-blink-features=AutomationControlled"],
  });

  try {
    // 네이버 검색
    console.log("[2] 네이버 검색...");
    await page.goto("https://www.naver.com/", { waitUntil: "domcontentloaded" });
    await sleep(1500);

    const searchQuery = "삼성전자 갤럭시 버즈3 프로";
    await page.type('input[name="query"]', searchQuery, { delay: 50 });
    await page.keyboard.press("Enter");
    await page.waitForNavigation({ waitUntil: "domcontentloaded" });
    await sleep(2000);

    // 스크롤
    console.log("[3] 스크롤...");
    for (let i = 0; i < 3; i++) {
      await page.evaluate(() => window.scrollBy(0, 400));
      await sleep(500);
    }

    // Bridge URL 찾기
    console.log("[4] Bridge/상품 URL 찾기...");
    const bridgeUrl = await page.evaluate(() => {
      const links = Array.from(document.querySelectorAll("a"));
      for (const link of links) {
        const href = link.href || "";
        if (href.includes("cr.shopping") || href.includes("cr2.shopping") ||
            href.includes("cr3.shopping") || href.includes("/bridge")) {
          return href;
        }
      }
      for (const link of links) {
        const href = link.href || "";
        if (href.includes("smartstore.naver.com") && href.includes("/products/")) {
          return href;
        }
      }
      return null;
    });

    if (!bridgeUrl) {
      console.log("❌ URL 없음");
      await browser.close();
      return;
    }

    console.log(`✅ URL: ${bridgeUrl.substring(0, 80)}...`);
    console.log("[5] 페이지 이동...");
    await page.goto(bridgeUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
    await sleep(5000);

    // CAPTCHA 감지
    console.log("\n[6] CAPTCHA 감지 중...");
    const currentUrl = page.url();
    console.log(`   현재 URL: ${currentUrl.substring(0, 80)}`);

    const pageAnalysis = await page.evaluate(() => {
      const bodyText = document.body.innerText || "";
      return {
        hasSecurityCheck: bodyText.includes("보안 확인"),
        hasReceipt: bodyText.includes("영수증"),
        hasQuestion: bodyText.includes("무엇입니까") || bodyText.includes("[?]"),
        hasRestricted: bodyText.includes("일시적으로 제한"),
        preview: bodyText.substring(0, 300),
      };
    });

    console.log("\n📋 페이지 분석:");
    console.log(`   보안 확인: ${pageAnalysis.hasSecurityCheck}`);
    console.log(`   영수증: ${pageAnalysis.hasReceipt}`);
    console.log(`   질문: ${pageAnalysis.hasQuestion}`);
    console.log(`   접근 제한: ${pageAnalysis.hasRestricted}`);

    const hasCaptcha = pageAnalysis.hasSecurityCheck || pageAnalysis.hasReceipt || pageAnalysis.hasQuestion;

    if (!hasCaptcha) {
      console.log("\n✅ CAPTCHA 없음 - PRB 덕분에 봇 탐지 우회됨!");
      console.log(`   페이지 내용: ${pageAnalysis.preview.substring(0, 150)}...`);
    } else if (pageAnalysis.hasRestricted) {
      console.log("\n⛔ IP 차단됨 - IP 변경 필요");
    } else {
      console.log("\n🔐 CAPTCHA 감지됨! 자동 해결 시도...");

      // 스크린샷 저장
      await page.screenshot({ path: "captcha_prb_screenshot.png", fullPage: true });

      // 질문 추출
      const question = await page.evaluate(() => {
        const bodyText = document.body.innerText || "";
        const match = bodyText.match(/.+무엇입니까\??/) ||
                     bodyText.match(/영수증의\s+.+?\s+\[?\?\]?\s*입니다/);
        return match ? match[0].trim() : bodyText.substring(0, 200);
      });

      console.log(`   질문: ${question}`);

      // Claude Vision으로 해결
      const answer = await solveCaptchaWithVision(page as any, question);

      if (answer) {
        console.log(`   Claude 응답: "${answer}"`);

        // 답 입력
        try {
          await humanType(page as any, 'input[type="text"]', answer);
          console.log("   답 입력 완료");

          // 확인 버튼 클릭
          await randomDelay(300, 600);
          const confirmBtn = await page.$('button:has-text("확인")') ||
                            await page.$('button[type="submit"]');
          if (confirmBtn) {
            await confirmBtn.click();
            console.log("   확인 버튼 클릭");
          } else {
            await page.keyboard.press("Enter");
            console.log("   Enter 키 입력");
          }

          await sleep(3000);

          // 결과 확인
          const stillCaptcha = await page.evaluate(() => {
            const bodyText = document.body.innerText || "";
            return bodyText.includes("보안 확인") || bodyText.includes("영수증");
          });

          if (!stillCaptcha) {
            console.log("\n🎉 CAPTCHA 해결 성공!");
          } else {
            console.log("\n❌ CAPTCHA 해결 실패");
          }
        } catch (err: any) {
          console.error("   입력 에러:", err.message);
        }
      } else {
        console.log("   ❌ Claude Vision 응답 실패");
      }
    }

    // 최종 상태
    console.log("\n[7] 최종 상태:");
    console.log(`   URL: ${page.url().substring(0, 80)}`);

    console.log("\n   20초 대기 후 종료...");
    await sleep(20000);

  } catch (error: any) {
    console.error("❌ 에러:", error.message);
  } finally {
    await browser.close();
    console.log("\n✅ 테스트 완료");
  }
}

main().catch(console.error);
