package com.baseball9;

import com.baseball9.ui.MainController;
import javafx.application.Application;
import javafx.scene.Scene;
import javafx.scene.image.Image;
import javafx.stage.Stage;

public class MainApp extends Application {

    public static final String APP_TITLE = "⚾ 야구9단 매니저";
    public static final int WIDTH  = 1100;
    public static final int HEIGHT = 750;

    @Override
    public void start(Stage stage) {
        MainController controller = new MainController(stage);
        Scene scene = controller.buildScene();

        stage.setTitle(APP_TITLE);
        stage.setScene(scene);
        stage.setMinWidth(900);
        stage.setMinHeight(600);
        stage.show();
    }

    public static void main(String[] args) {
        launch(args);
    }
}
