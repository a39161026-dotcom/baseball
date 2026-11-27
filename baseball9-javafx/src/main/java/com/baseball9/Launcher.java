package com.baseball9;

/**
 * 실행 진입점.
 * MainApp 이 Application 을 상속하므로 그 클래스를 바로 main 으로 쓰면
 * 클래스패스 실행(bat/sh 스크립트)에서 JavaFX 확인 오류가 납니다.
 * 이 클래스는 Application 을 상속하지 않아서 어디서든 실행됩니다.
 */
public class Launcher {
    public static void main(String[] args) {
        MainApp.main(args);
    }
}
